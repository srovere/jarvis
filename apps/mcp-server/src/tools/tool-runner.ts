import { DomainError, ReauthRequired, TOKENS, type ProviderRegistry } from '@jarvis/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Inject, Injectable, Logger } from '@nestjs/common';

/** What a tool produces: a compact human-readable summary and the structured result. */
export interface ToolOutput {
  text: string;
  structured: object;
}

const INTERNAL_ERROR = 'Internal error';

/**
 * Runs a tool body and shapes the MCP result. A `DomainError` becomes a tool error with its message; any other
 * error becomes a generic "Internal error" (details go to the log, never to the client).
 */
@Injectable()
export class ToolRunner {
  private readonly logger = new Logger('McpTools');

  constructor(@Inject(TOKENS.ProviderRegistry) private readonly registry: Pick<ProviderRegistry, 'invalidate'>) {}

  async run(tool: string, body: () => Promise<ToolOutput>): Promise<CallToolResult> {
    try {
      const { text, structured } = await body();
      return { content: [{ type: 'text', text }], structuredContent: structured as Record<string, unknown> };
    } catch (e) {
      if (e instanceof ReauthRequired) {
        // Drop the cached client (it holds the rejected token) so a later `jarvis auth` is picked up without a restart.
        this.registry.invalidate(e.accountId);
        this.logger.warn(JSON.stringify({ msg: 'account needs re-authorization', accountId: e.accountId, tool }));
      }
      if (e instanceof DomainError) return this.error(e.message);
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.error(`Tool ${tool} failed: ${detail}`, e instanceof Error ? e.stack : undefined);
      return this.error(INTERNAL_ERROR);
    }
  }

  private error(text: string): CallToolResult {
    return { isError: true, content: [{ type: 'text', text }] };
  }
}
