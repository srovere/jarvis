import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { defaultConfigPath, JsonLogger, requireDatabaseUrl, stderrLogSink } from '@jarvis/composition';
import { loadConfig } from '@jarvis/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const path = resolve(defaultConfigPath(process.env, process.cwd()));
  const config = loadConfig(path, process.env);
  const module = AppModule.forRoot({ config, configDir: dirname(path), databaseUrl: requireDatabaseUrl(process.env) });
  const app = await NestFactory.create<NestExpressApplication>(module, {
    logger: new JsonLogger(stderrLogSink),
    abortOnError: false,
  });
  // Close the MCP sessions (McpSessions) and the database on SIGTERM/SIGINT.
  app.enableShutdownHooks();
  await app.listen(config.mcp.port, config.mcp.bind);
}

bootstrap().catch((e: unknown) => {
  stderrLogSink(JSON.stringify({ level: 'fatal', msg: 'mcp-server failed to start', error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
