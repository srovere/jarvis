import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Credentials } from 'google-auth-library';

const ACCOUNT_ID = /^[a-z0-9][a-z0-9_-]*$/;

/** On-disk OAuth token store: one `0600` JSON per account inside a `0700` directory. */
export class FileTokenStore {
  constructor(private readonly dir: string) {}

  async read(accountId: string): Promise<Credentials | null> {
    const file = this.fileFor(accountId);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Credentials;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(accountId: string, credentials: Credentials): Promise<void> {
    const file = this.fileFor(accountId);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
      await rename(tmp, file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  /** Removes the token file; a missing one is not an error. */
  async delete(accountId: string): Promise<void> {
    await rm(this.fileFor(accountId), { force: true });
  }

  /** Modification time (ms) and size of the token file, or `null` when there is none. */
  async stat(accountId: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const { mtimeMs, size } = await stat(this.fileFor(accountId));
      return { mtimeMs, size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private fileFor(accountId: string): string {
    if (!ACCOUNT_ID.test(accountId)) throw new Error(`Invalid account id: ${JSON.stringify(accountId)}`);
    return join(this.dir, `google-${accountId}.json`);
  }
}
