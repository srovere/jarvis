import { mcpTokenPath, ProvidersModule, type ProvidersModuleOptions } from '@jarvis/composition';
import { Module, type DynamicModule } from '@nestjs/common';
import { BearerGuard, MCP_BEARER_TOKEN, readBearerToken } from './bearer.guard';
import { HealthController } from './health.controller';
import { McpServerFactory } from './mcp-server.factory';
import { McpSessions } from './mcp-sessions';
import { McpController } from './mcp.controller';
import { BriefingTools } from './tools/briefing.tools';
import { CalendarTools } from './tools/calendar.tools';
import { EmailTools } from './tools/email.tools';
import { SyncTools } from './tools/sync.tools';
import { TasksTools } from './tools/tasks.tools';
import { ToolRunner } from './tools/tool-runner';

/** The MCP server: Jarvis tools over Streamable HTTP at `/mcp` (bearer token) plus `/health`. */
@Module({})
export class AppModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [ProvidersModule.forRoot(options)],
      controllers: [McpController, HealthController],
      providers: [
        { provide: MCP_BEARER_TOKEN, useFactory: () => readBearerToken(mcpTokenPath(options.config, options.configDir)) },
        BearerGuard,
        ToolRunner,
        BriefingTools,
        EmailTools,
        CalendarTools,
        TasksTools,
        SyncTools,
        McpServerFactory,
        McpSessions,
      ],
    };
  }
}
