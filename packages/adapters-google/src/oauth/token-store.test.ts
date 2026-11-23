import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileTokenStore } from './token-store';

describe('FileTokenStore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-tokens-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns null when there is no token', async () => {
    expect(await new FileTokenStore(join(root, 'tokens')).read('personal')).toBeNull();
  });

  it('writes a 0600 file in a 0700 dir and reads it back', async () => {
    const dir = join(root, 'tokens');
    const store = new FileTokenStore(dir);
    await store.write('personal', { refresh_token: 'r1', access_token: 'a1' });
    expect(statSync(join(dir, 'google-personal.json')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(await store.read('personal')).toEqual({ refresh_token: 'r1', access_token: 'a1' });
  });

  it('overwrites atomically leaving no temp files', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = join(root, 'tokens');
    const store = new FileTokenStore(dir);
    await store.write('personal', { refresh_token: 'r1' });
    await store.write('personal', { refresh_token: 'r2' });
    expect((await store.read('personal'))?.refresh_token).toBe('r2');
    expect(readdirSync(dir)).toEqual(['google-personal.json']);
  });

  it('leaves no temp file behind when the write fails', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = join(root, 'tokens');
    mkdirSync(join(dir, 'google-personal.json'), { recursive: true });
    await expect(new FileTokenStore(dir).write('personal', { refresh_token: 'r1' })).rejects.toThrow();
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects account ids that could escape the directory', async () => {
    const store = new FileTokenStore(join(root, 'tokens'));
    for (const bad of ['../evil', 'a/b', '', 'Upper', '-x', '.hidden']) {
      await expect(store.write(bad, {})).rejects.toThrow(/invalid account id/i);
      await expect(store.read(bad)).rejects.toThrow(/invalid account id/i);
    }
  });
});
