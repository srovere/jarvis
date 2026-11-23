import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { requireDatabaseUrl, stderrLogSink } from '@jarvis/composition';
import { loadConfig } from '@jarvis/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { defaultConfigPath } from './cli/jarvis';
import { JsonLogger } from './json-logger';

async function bootstrap(): Promise<void> {
  const path = resolve(defaultConfigPath(process.env, process.cwd()));
  const config = loadConfig(path, process.env);
  const module = AppModule.forRoot({ config, configDir: dirname(path), databaseUrl: requireDatabaseUrl(process.env) });
  const app = await NestFactory.createApplicationContext(module, { logger: new JsonLogger(stderrLogSink) });
  app.enableShutdownHooks();
}

bootstrap().catch((e: unknown) => {
  stderrLogSink(JSON.stringify({ level: 'fatal', msg: 'worker failed to start', error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
