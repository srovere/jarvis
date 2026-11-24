import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileAgentCredentialStore } from './file-agent-credential-store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-agent-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileAgentCredentialStore', () => {
  it('writes <dataDir>/agent/claude-token with mode 0600 and reads it back', async () => {
    const store = new FileAgentCredentialStore(dir);
    expect(await store.present()).toBe(false);
    expect(await store.read()).toBeNull();
    await store.save('sk-ant-oat01-abc');
    const file = join(dir, 'agent', 'claude-token');
    expect(await readFile(file, 'utf8')).toBe('sk-ant-oat01-abc');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await store.present()).toBe(true);
    expect(await store.read()).toBe('sk-ant-oat01-abc');
  });

  it('overwrites and leaves no temporary files', async () => {
    const store = new FileAgentCredentialStore(dir);
    await store.save('one');
    await store.save('two');
    expect(await store.read()).toBe('two');
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(join(dir, 'agent'))).toEqual(['claude-token']);
  });

  it('clear removes the file and tolerates a missing one', async () => {
    const store = new FileAgentCredentialStore(dir);
    await store.save('x');
    await store.clear();
    expect(await store.present()).toBe(false);
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
