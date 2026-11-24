import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { defaultConfigPath, JsonLogger, requireDatabaseUrl, stderrLogSink } from '@jarvis/composition';
import { loadOptionalConfig } from '@jarvis/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_APP_OPTIONS, AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const path = resolve(defaultConfigPath(process.env, process.cwd()));
  const { config, present } = loadOptionalConfig(path, process.env);
  const module = AppModule.forRoot({ config, configDir: dirname(path), configPresent: present, databaseUrl: requireDatabaseUrl(process.env) });
  const app = await NestFactory.create<NestExpressApplication>(module, {
    logger: new JsonLogger(stderrLogSink),
    abortOnError: false,
    ...API_APP_OPTIONS,
  });
  app.enableShutdownHooks();
  // 0.0.0.0 inside the container; compose publishes the port on 127.0.0.1 only.
  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}

bootstrap().catch((e: unknown) => {
  stderrLogSink(JSON.stringify({ level: 'fatal', msg: 'api failed to start', error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
