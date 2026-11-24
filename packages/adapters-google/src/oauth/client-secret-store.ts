import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface ClientSecret {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Anything that can supply the Google OAuth client credentials. */
export interface ClientSecretReader {
  read(): Promise<ClientSecret>;
}

export class InvalidClientSecret extends Error {}

/**
 * Parses a Google OAuth client file. Accepts the `installed` (Desktop app) format and a flat
 * `{client_id, client_secret}` object; rejects `web` clients. Messages never echo the content.
 */
export function parseClientSecret(json: string, options: { allowFlat?: boolean } = {}): ClientSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidClientSecret('The OAuth client file is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidClientSecret('The OAuth client file must be a JSON object');
  }
  const root = parsed as Record<string, unknown>;
  if ('web' in root && !('installed' in root)) {
    throw new InvalidClientSecret('This is a web OAuth client. Create an OAuth client of type Desktop app');
  }
  if (!('installed' in root) && options.allowFlat === false) {
    throw new InvalidClientSecret('The OAuth client file has no "installed" section (Desktop app client)');
  }
  const candidate = 'installed' in root ? root.installed : root;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new InvalidClientSecret('The OAuth client file has no "installed" section (Desktop app client)');
  }
  const { client_id: clientId, client_secret: clientSecret } = candidate as Record<string, unknown>;
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new InvalidClientSecret('The OAuth client file is missing client_id');
  }
  if (typeof clientSecret !== 'string' || clientSecret.trim() === '') {
    throw new InvalidClientSecret('The OAuth client file is missing client_secret');
  }
  return { clientId, clientSecret };
}

/** Reads the client credentials from one explicit file. */
export class FileClientSecretReader implements ClientSecretReader {
  constructor(private readonly path: string) {}

  async read(): Promise<ClientSecret> {
    return parseClientSecret(await readFile(this.path, 'utf8'));
  }
}

/** Uploaded OAuth client (`dataDir/google/oauth-client.json`, `0600`) with a legacy docker-secret fallback. */
export class GoogleClientSecretStore implements ClientSecretReader {
  private readonly file: string;
  private readonly legacyFile?: string;

  constructor(options: { dataDir: string; legacySecretsDir?: string }) {
    this.file = join(options.dataDir, 'google', 'oauth-client.json');
    this.legacyFile = options.legacySecretsDir ? join(options.legacySecretsDir, 'google_oauth_client') : undefined;
  }

  async status(): Promise<'present' | 'missing'> {
    return (await this.locate()) ? 'present' : 'missing';
  }

  /** Validates and stores the uploaded file; nothing is written when it is invalid. */
  async save(json: string): Promise<void> {
    const { clientId, clientSecret } = parseClientSecret(json, { allowFlat: false });
    const content = JSON.stringify({ installed: { client_id: clientId, client_secret: clientSecret } });
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, content, { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async read(): Promise<ClientSecret> {
    const file = await this.locate();
    if (!file) throw new InvalidClientSecret('No Google OAuth client configured: upload the client file first');
    return parseClientSecret(await readFile(file, 'utf8'));
  }

  private async locate(): Promise<string | null> {
    for (const candidate of [this.file, this.legacyFile]) {
      if (!candidate) continue;
      try {
        await readFile(candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return null;
  }
}
