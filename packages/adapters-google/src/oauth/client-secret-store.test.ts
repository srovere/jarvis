import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoogleClientSecretStore } from './client-secret-store';

const VALID = JSON.stringify({ installed: { client_id: 'cid', client_secret: 'csecret' } });

describe('GoogleClientSecretStore', () => {
  let root: string;
  let store: GoogleClientSecretStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-client-'));
    store = new GoogleClientSecretStore({ dataDir: join(root, 'data'), legacySecretsDir: join(root, 'secrets') });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is missing until saved, then readable and 0600', async () => {
    expect(await store.status()).toBe('missing');
    await store.save(VALID);
    expect(await store.status()).toBe('present');
    expect(await store.read()).toEqual({ clientId: 'cid', clientSecret: 'csecret' });
    expect(statSync(join(root, 'data', 'google', 'oauth-client.json')).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['garbage', 'not json at all SECRET-ECHO', /not valid JSON/],
    ['a JSON array', '[]', /JSON object/],
    ['a web client', JSON.stringify({ web: { client_id: 'a', client_secret: 'b' } }), /Create an OAuth client of type Desktop app/],
    ['missing client_secret', JSON.stringify({ installed: { client_id: 'a' } }), /client_secret/],
    ['missing client_id', JSON.stringify({ installed: { client_secret: 'b' } }), /client_id/],
    ['no installed section', JSON.stringify({ client_id: 'a', client_secret: 'b' }), /installed/],
  ])('rejects %s without storing or echoing it', async (_name, json, message) => {
    const error = await store.save(json).then(() => null, (e: Error) => e);
    expect(error?.message).toMatch(message);
    expect(error?.message).not.toContain('SECRET-ECHO');
    expect(await store.status()).toBe('missing');
    expect(() => readdirSync(join(root, 'data', 'google'))).toThrow();
  });

  it('falls back to the legacy secret and prefers the uploaded file', async () => {
    mkdirSync(join(root, 'secrets'));
    writeFileSync(join(root, 'secrets', 'google_oauth_client'), JSON.stringify({ installed: { client_id: 'old', client_secret: 'olds' } }));
    expect(await store.status()).toBe('present');
    expect((await store.read()).clientId).toBe('old');
    await store.save(VALID);
    expect((await store.read()).clientId).toBe('cid');
  });

  it('read fails clearly when nothing is configured', async () => {
    await expect(store.read()).rejects.toThrow(/upload the client file/);
  });
});
