import { readFileSync } from 'node:fs';
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

/** File holding the MCP bearer token; a relative `mcp.tokenFile` resolves against the configuration file's directory. */
export function mcpTokenPath(config: JarvisConfig, configDir: string): string {
  return resolve(configDir, config.mcp.tokenFile);
}

/**
 * Connection string for the database, in order of precedence:
 * `DATABASE_URL`; `DATABASE_URL_FILE` (file holding the whole URL); `PGPASSWORD_FILE` (a Docker secret holding only
 * the password, combined with `JARVIS_DB_HOST`/`JARVIS_DB_USER`/`JARVIS_DB_NAME`, default `db`/`jarvis`/`jarvis`).
 * Throws a clear error when none is available.
 */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL?.trim();
  if (url) return url;
  const urlFile = env.DATABASE_URL_FILE?.trim();
  if (urlFile) return readSecret('DATABASE_URL_FILE', urlFile);
  const passwordFile = env.PGPASSWORD_FILE?.trim();
  if (passwordFile) {
    const password = encodeURIComponent(readSecret('PGPASSWORD_FILE', passwordFile));
    const user = encodeURIComponent(env.JARVIS_DB_USER?.trim() || 'jarvis');
    const host = env.JARVIS_DB_HOST?.trim() || 'db';
    const name = encodeURIComponent(env.JARVIS_DB_NAME?.trim() || 'jarvis');
    return `postgres://${user}:${password}@${host}:5432/${name}`;
  }
  throw new Error(
    'Missing environment variable DATABASE_URL (e.g. postgres://user:password@host:5432/jarvis), DATABASE_URL_FILE or PGPASSWORD_FILE',
  );
}

function readSecret(variable: string, file: string): string {
  let content: string;
  try {
    content = readFileSync(file, 'utf8').trim();
  } catch (e) {
    throw new Error(`Could not read the ${variable} file (${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!content) throw new Error(`The ${variable} file (${file}) is empty`);
  return content;
}
