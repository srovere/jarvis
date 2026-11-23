import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { McpServerFactory } from './mcp-server.factory';

/** Live Streamable HTTP sessions: one MCP server + transport per `mcp-session-id`, dropped when the transport closes. */
@Injectable()
export class McpSessions implements BeforeApplicationShutdown {
  private readonly sessions = new Map<string, StreamableHTTPServerTransport>();

  constructor(private readonly factory: McpServerFactory) {}

  get(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** A new transport connected to a fresh server; it is stored once the client's `initialize` assigns its session id. */
  async open(): Promise<StreamableHTTPServerTransport> {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        this.sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) this.sessions.delete(transport.sessionId);
    };
    await this.factory.create().connect(transport);
    return transport;
  }

  async beforeApplicationShutdown(): Promise<void> {
    const open = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(open.map((t) => t.close()));
  }
}
