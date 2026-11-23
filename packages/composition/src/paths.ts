import { resolve } from 'node:path';
import type { JarvisConfig } from '@jarvis/config';

export interface AuthPaths {
  readonly clientSecretPath: string;
  readonly tokenDir: string;
}

/** OAuth file locations; relative `secretsDir`/`dataDir` resolve against the configuration file's directory. */
export function authPaths(config: JarvisConfig, configDir: string): AuthPaths {
  return {
    clientSecretPath: resolve(configDir, config.secretsDir, 'google_oauth_client'),
    tokenDir: resolve(configDir, config.dataDir, 'tokens'),
  };
}

/** `DATABASE_URL` from the environment; a clear error when it is missing. */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('Falta la variable de entorno DATABASE_URL (p. ej. postgres://usuario:clave@host:5432/jarvis)');
  }
  return url;
}
