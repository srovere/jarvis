import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { AgentCredentialStore } from '@jarvis/core';

/** Claude subscription token on disk: `<dataDir>/agent/claude-token`, mode 0600, written atomically. */
export class FileAgentCredentialStore implements AgentCredentialStore {
  private readonly dir: string;
  private readonly file: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'agent');
    this.file = join(this.dir, 'claude-token');
  }

  async save(token: string): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, token, { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async present(): Promise<boolean> {
    return (await this.read()) !== null;
  }

  /** The stored token, or `null`. Not part of the port: only the runner needs the secret itself. */
  async read(): Promise<string | null> {
    try {
      const token = (await readFile(this.file, 'utf8')).trim();
      return token || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
