import { join } from 'node:path';
import { ProvidersModule, type ProvidersModuleOptions } from '@jarvis/composition';
import { Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { HealthController } from './health.controller';
import { LocalOnlyGuard } from './local-only.guard';
import { MCP_CLIENT_OPTIONS, McpClientService, mcpClientOptionsFromEnv, type McpClientOptions } from './mcp-client.service';
import { SetupController } from './setup.controller';

export interface ApiModuleOptions extends ProvidersModuleOptions {
  /** Built dashboard directory; may not exist yet. Default `JARVIS_WEB_DIST` or `apps/web/dist`. */
  readonly webDist?: string;
  readonly mcp?: McpClientOptions;
}

/** The API: local-only guard, setup endpoints, the MCP client and the static dashboard. */
@Module({})
export class AppModule implements NestModule {
  static forRoot(options: ApiModuleOptions): DynamicModule {
    const webDist = options.webDist ?? (process.env.JARVIS_WEB_DIST?.trim() || join(process.cwd(), 'apps', 'web', 'dist'));
    return {
      module: AppModule,
      imports: [
        ProvidersModule.forRoot(options),
        // Express 5 route syntax; `/api` stays out of the SPA fallback.
        ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api', '/api/{*path}'] }),
      ],
      controllers: [HealthController, SetupController],
      providers: [
        LocalOnlyGuard,
        { provide: MCP_CLIENT_OPTIONS, useValue: options.mcp ?? mcpClientOptionsFromEnv(process.env) },
        McpClientService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Every route, static files included.
    consumer.apply(LocalOnlyGuard).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
