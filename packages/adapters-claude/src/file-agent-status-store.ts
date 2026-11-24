import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStatus, AgentStatusStore } from '@jarvis/core';

const STATES = ['connected', 'failed', 'skipped'];

function isAgentStatus(v: unknown): v is AgentStatus {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return typeof s.status === 'string' && STATES.includes(s.status) && typeof s.verifiedAt === 'string';
}

/** Agent connection result as `<dataDir>/agent/status.json` (no secret in it). */
export class FileAgentStatusStore implements AgentStatusStore {
  private readonly dir: string;
  private readonly file: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'agent');
    this.file = join(this.dir, 'status.json');
  }

  /** `null` when never recorded or when the file is unreadable or malformed. */
  async load(): Promise<AgentStatus | null> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      return isAgentStatus(data) ? data : null;
    } catch {
      return null;
    }
  }

  async save(status: AgentStatus): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(status), { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }
}
