import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileAgentStatusStore } from './file-agent-status-store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-agent-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileAgentStatusStore', () => {
  it('is null until saved, then round-trips', async () => {
    const store = new FileAgentStatusStore(dir);
    expect(await store.load()).toBeNull();
    const s = { provider: 'claude', status: 'connected' as const, verifiedAt: '2026-11-24T10:00:00.000Z', latencyMs: 5 };
    await store.save(s);
    expect(await store.load()).toEqual(s);
  });

  it('treats a malformed file as absent', async () => {
    await mkdir(join(dir, 'agent'));
    await writeFile(join(dir, 'agent', 'status.json'), '{"status":"weird"}');
    expect(await new FileAgentStatusStore(dir).load()).toBeNull();
  });
});
