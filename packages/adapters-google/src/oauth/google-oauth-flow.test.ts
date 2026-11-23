import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReauthRequired } from '@jarvis/core';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleOAuthFlow } from './google-oauth-flow';
import { FileTokenStore } from './token-store';

const SECRET = { installed: { client_id: 'cid', client_secret: 'csecret' } };

describe('GoogleOAuthFlow', () => {
  let root: string;
  let store: FileTokenStore;
  let secretPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-oauth-'));
    store = new FileTokenStore(join(root, 'tokens'));
    secretPath = join(root, 'google_oauth_client');
    writeFileSync(secretPath, JSON.stringify(SECRET));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  describe('options', () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each(['0', '65536', 'abc', '1.5', ''])('rejects invalid JARVIS_OAUTH_PORT %j', (port) => {
      vi.stubEnv('JARVIS_OAUTH_PORT', port);
      expect(() => new GoogleOAuthFlow(secretPath, store)).toThrow(/JARVIS_OAUTH_PORT/);
    });

    it('accepts a valid JARVIS_OAUTH_PORT', () => {
      vi.stubEnv('JARVIS_OAUTH_PORT', '4000');
      expect(() => new GoogleOAuthFlow(secretPath, store)).not.toThrow();
    });
  });

  describe('client()', () => {
    it('throws ReauthRequired when no token is stored', async () => {
      const flow = new GoogleOAuthFlow(secretPath, store);
      await expect(flow.client('personal')).rejects.toMatchObject({
        constructor: ReauthRequired,
        message: 'Account personal needs re-authorization',
      });
    });

    it('sets stored credentials on the client', async () => {
      await store.write('personal', { refresh_token: 'r1', access_token: 'a1' });
      const client = await new GoogleOAuthFlow(secretPath, store).client('personal');
      expect(client.credentials.refresh_token).toBe('r1');
    });

    it('persists refreshed tokens, keeping the old refresh_token when absent', async () => {
      await store.write('personal', { refresh_token: 'r1', access_token: 'a1' });
      const client = await new GoogleOAuthFlow(secretPath, store).client('personal');
      client.emit('tokens', { access_token: 'a2', expiry_date: 123 });
      await vi.waitFor(async () => {
        expect(await store.read('personal')).toEqual({ refresh_token: 'r1', access_token: 'a2', expiry_date: 123 });
      });
    });

    it('persists a new refresh_token from the event', async () => {
      await store.write('personal', { refresh_token: 'r1', access_token: 'a1' });
      const client = await new GoogleOAuthFlow(secretPath, store).client('personal');
      client.emit('tokens', { refresh_token: 'r2', access_token: 'a2' });
      await vi.waitFor(async () => {
        expect((await store.read('personal'))?.refresh_token).toBe('r2');
      });
    });
  });

  describe('authorizeInteractive()', () => {
    let urls: string[];
    beforeEach(() => {
      urls = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        urls.push(String(chunk));
        return true;
      });
    });

    const authUrl = async (): Promise<URL> => {
      const line = await vi.waitFor(() => {
        const found = urls.join('').split('\n').find((l) => l.startsWith('https://'));
        if (!found) throw new Error('no url yet');
        return found;
      });
      return new URL(line);
    };

    it('stores tokens after a valid callback', async () => {
      const getToken = vi
        .spyOn(OAuth2Client.prototype, 'getToken')
        .mockResolvedValue({ tokens: { refresh_token: 'r1', access_token: 'a1' } } as never);
      const flow = new GoogleOAuthFlow(secretPath, store, { port: 0 });
      const done = flow.authorizeInteractive('personal');
      const url = await authUrl();
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      const redirect = new URL(url.searchParams.get('redirect_uri')!);
      expect(redirect.hostname).toBe('127.0.0.1');
      expect(redirect.pathname).toBe('/oauth2callback');
      const res = await fetch(`${redirect.origin}/oauth2callback?code=abc&state=${url.searchParams.get('state')}`);
      expect(await res.text()).toContain('Done, you can close this tab.');
      await done;
      expect(getToken).toHaveBeenCalledWith('abc');
      expect(await store.read('personal')).toEqual({ refresh_token: 'r1', access_token: 'a1' });
    });

    it('rejects a callback with a wrong state and keeps waiting', async () => {
      vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({ tokens: { refresh_token: 'r1' } } as never);
      const flow = new GoogleOAuthFlow(secretPath, store, { port: 0 });
      const done = flow.authorizeInteractive('personal');
      const url = await authUrl();
      const origin = new URL(url.searchParams.get('redirect_uri')!).origin;
      expect((await fetch(`${origin}/oauth2callback?code=abc&state=bad`)).status).toBe(400);
      await fetch(`${origin}/oauth2callback?code=abc&state=${url.searchParams.get('state')}`);
      await done;
      expect(await store.read('personal')).not.toBeNull();
    });

    it('fails clearly when Google returns no refresh_token', async () => {
      vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({ tokens: { access_token: 'a1' } } as never);
      const flow = new GoogleOAuthFlow(secretPath, store, { port: 0 });
      const done = flow.authorizeInteractive('personal');
      const assertion = expect(done).rejects.toThrow(/refresh_token/);
      const url = await authUrl();
      const origin = new URL(url.searchParams.get('redirect_uri')!).origin;
      await fetch(`${origin}/oauth2callback?code=abc&state=${url.searchParams.get('state')}`);
      await assertion;
      expect(await store.read('personal')).toBeNull();
    });

    it('fails fast and clears the timer when the port is in use', async () => {
      const { createServer } = await import('node:net');
      const blocker = createServer();
      await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
      const port = (blocker.address() as import('node:net').AddressInfo).port;
      const clear = vi.spyOn(globalThis, 'clearTimeout');
      try {
        const flow = new GoogleOAuthFlow(secretPath, store, { port });
        await expect(flow.authorizeInteractive('personal')).rejects.toThrow(/EADDRINUSE/);
        expect(clear).toHaveBeenCalled();
      } finally {
        blocker.close();
      }
    });

    it('times out with a clear error', async () => {
      const flow = new GoogleOAuthFlow(secretPath, store, { port: 0, timeoutMs: 20 });
      await expect(flow.authorizeInteractive('personal')).rejects.toThrow(/Timed out/);
    });
  });
});
