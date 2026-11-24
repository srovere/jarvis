import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Injectable } from '@nestjs/common';
import { BriefingTools } from './tools/briefing.tools';
import { CalendarTools } from './tools/calendar.tools';
import { EmailTools } from './tools/email.tools';
import { SyncTools } from './tools/sync.tools';
import { TasksTools } from './tools/tasks.tools';
import type { ToolGroup } from './tools/tool-group';

/** Builds the `jarvis` MCP server with every tool group registered (one server per session). */
@Injectable()
export class McpServerFactory {
  private readonly groups: ToolGroup[];

  constructor(briefing: BriefingTools, email: EmailTools, calendar: CalendarTools, tasks: TasksTools, sync: SyncTools) {
    this.groups = [briefing, email, calendar, tasks, sync];
  }

  create(): McpServer {
    const server = new McpServer({ name: 'jarvis', version: '0.1.0' });
    for (const group of this.groups) group.register(server);
    return server;
  }
}
