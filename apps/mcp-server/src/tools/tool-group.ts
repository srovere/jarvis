import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** A set of related MCP tools that registers itself on a server. */
export interface ToolGroup {
  register(server: McpServer): void;
}
