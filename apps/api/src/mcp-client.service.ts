import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BadGatewayException, Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';

export interface McpClientOptions {
  readonly url: string;
  readonly tokenFile: string;
}

export const MCP_CLIENT_OPTIONS = Symbol('McpClientOptions');

export function mcpClientOptionsFromEnv(env: NodeJS.ProcessEnv): McpClientOptions {
  return {
    url: env.JARVIS_MCP_URL?.trim() || 'http://mcp-server:3002/mcp',
    tokenFile: env.JARVIS_MCP_TOKEN_FILE?.trim() || '/run/secrets/mcp_token',
  };
}

/**
 * The API's single MCP client. Connects lazily, calls `mcp-server` tools and returns their `structuredContent`.
 * A lost session (server restart) is retried once on a fresh connection; a tool error becomes `502 { error }`.
 * The bearer token is read from its file on connect and never logged.
 */
@Injectable()
export class McpClientService implements OnModuleDestroy {
  private connecting: Promise<Client> | null = null;

  constructor(@Inject(MCP_CLIENT_OPTIONS) private readonly options: McpClientOptions) {}

  async call<T>(tool: string, args: object = {}): Promise<T> {
    let result;
    try {
      result = await this.invoke(tool, args);
    } catch (e) {
      if (!isSessionLoss(e)) throw unavailable();
      await this.reset();
      try {
        result = await this.invoke(tool, args);
      } catch {
        throw unavailable();
      }
    }
    if (result.isError) throw new BadGatewayException({ error: textOf(result.content) || `tool ${tool} failed` });
    if (result.structuredContent === undefined) throw new BadGatewayException({ error: `tool ${tool} returned no structured content` });
    return result.structuredContent as T;
  }

  async onModuleDestroy(): Promise<void> {
    await this.reset();
  }

  private async invoke(tool: string, args: object) {
    const client = await this.client();
    return (await client.callTool({ name: tool, arguments: args as Record<string, unknown> })) as {
      isError?: boolean;
      content?: unknown;
      structuredContent?: unknown;
    };
  }

  private client(): Promise<Client> {
    this.connecting ??= this.connect().catch((e: unknown) => {
      this.connecting = null;
      throw e;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const token = readFileSync(this.options.tokenFile, 'utf8').trim();
    const client = new Client({ name: 'jarvis-api', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(this.options.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return client;
  }

  private async reset(): Promise<void> {
    const pending = this.connecting;
    this.connecting = null;
    if (!pending) return;
    try {
      await (await pending).close();
    } catch {
      // The connection is already gone.
    }
  }
}

function unavailable(): BadGatewayException {
  return new BadGatewayException({ error: 'MCP server unavailable' });
}

/** The server forgot the session (restart) or the connection dropped. */
function isSessionLoss(e: unknown): boolean {
  if (e instanceof StreamableHTTPError) return e.code === 404 || e.code === 400;
  if (e instanceof McpError) return e.code === ErrorCode.ConnectionClosed;
  return e instanceof Error && /not connected|session/i.test(e.message);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}
