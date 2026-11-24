import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleClientSecretStore } from '@jarvis/adapters-google';
import { DomainError } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { GoogleClientUpload } from './google-client-store';

describe('GoogleClientUpload', () => {
  it('saves a desktop client and reports it present', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-gc-'));
    const upload = new GoogleClientUpload(new GoogleClientSecretStore({ dataDir }));
    expect(await upload.status()).toBe('missing');
    await upload.save(JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }));
    expect(await upload.status()).toBe('present');
  });

  it('turns an invalid file into a DomainError and stores nothing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-gc-'));
    const upload = new GoogleClientUpload(new GoogleClientSecretStore({ dataDir }));
    const error = await upload.save(JSON.stringify({ web: { client_id: 'id', client_secret: 's' } })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as Error).message).toContain('Desktop app');
    expect(await upload.status()).toBe('missing');
    expect(await readdir(dataDir)).toEqual([]);
  });
});
