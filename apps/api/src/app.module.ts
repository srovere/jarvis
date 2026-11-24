import { join } from 'node:path';
import { ProvidersModule, type ProvidersModuleOptions } from '@jarvis/composition';
import { Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { json, type NextFunction, type Request, type Response } from 'express';
import { AccountsController } from './accounts.controller';
import { AgentController } from './agent.controller';
import { GoogleClientController } from './google-client.controller';
import { DATA_CONTROLLERS } from './data.controller';
import { ErrorFilter } from './http-errors';
import { OAuthController } from './oauth.controller';
import { SettingsController } from './settings.controller';
import { HealthController } from './health.controller';
import { LocalOnlyGuard } from './local-only.guard';
import { MCP_CLIENT_OPTIONS, McpClientService, mcpClientOptionsFromEnv, type McpClientOptions } from './mcp-client.service';
import { SetupController } from './setup.controller';

export interface ApiModuleOptions extends ProvidersModuleOptions {
  /** Built dashboard directory; may not exist yet. Default `JARVIS_WEB_DIST` or `apps/web/dist`. */
  readonly webDist?: string;
  readonly mcp?: McpClientOptions;
}

const parseJson = json({ limit: '256kb' });

/** Parses JSON bodies and answers a bad one itself: an error passed to `next` would be rewritten by the static module. */
function jsonBody(req: Request, res: Response, next: NextFunction): void {
  parseJson(req, res, (error?: unknown) => {
    if (!error) return next();
    const status = (error as { status?: number }).status;
    const tooLarge = status === 413;
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Request body too large' : 'Malformed JSON body' });
  });
}

/** Options every Nest application hosting `AppModule` must use: body parsing is done by the module, after the guard. */
export const API_APP_OPTIONS = { bodyParser: false } as const;

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
      controllers: [
        HealthController,
        SetupController,
        AccountsController,
        GoogleClientController,
        OAuthController,
        SettingsController,
        AgentController,
        ...DATA_CONTROLLERS,
      ],
      providers: [
        LocalOnlyGuard,
        { provide: APP_FILTER, useClass: ErrorFilter },
        { provide: MCP_CLIENT_OPTIONS, useValue: options.mcp ?? mcpClientOptionsFromEnv(process.env) },
        McpClientService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Every route, static files included. The guard runs before the JSON parser (Nest's own parser is disabled), so a
    // forbidden request is answered 403 even when its body is malformed.
    consumer
      .apply(LocalOnlyGuard, jsonBody)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
