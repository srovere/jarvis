import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAccountConnector } from './google-account-connector';
import { GOOGLE_SCOPES } from './scopes';
import { FileTokenStore } from './token-store';

const REDIRECT = 'http://127.0.0.1:3000/api/onboarding/oauth/callback';

describe('GoogleAccountConnector', () => {
  let root: string;
  let store: FileTokenStore;
  let connector: GoogleAccountConnector;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-connector-'));
    store = new FileTokenStore(join(root, 'tokens'));
    connector = new GoogleAccountConnector(
      { read: async () => ({ clientId: 'cid', clientSecret: 'csecret' }) },
      store,
      async () => 'Me@Example.com',
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('builds a PKCE URL with exactly the 5 scopes', async () => {
    const { url, state, verifier } = await connector.beginAuthorization({ redirectUri: REDIRECT });
    const u = new URL(url);
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual([...GOOGLE_SCOPES].sort());
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe(state);
    expect(verifier.length).toBeGreaterThan(20);
  });

  it('completes: returns email and granted scopes, sends the verifier', async () => {
    const getToken = vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
      tokens: { refresh_token: 'r1', access_token: 'a1', scope: GOOGLE_SCOPES.join(' ') },
    } as never);
    const result = await connector.completeAuthorization({ code: 'c', redirectUri: REDIRECT, verifier: 'v' });
    expect(getToken).toHaveBeenCalledWith({ code: 'c', codeVerifier: 'v', redirect_uri: REDIRECT });
    expect(result.email.address).toBe('me@example.com');
    expect(result.grantedScopes).toEqual([...GOOGLE_SCOPES]);
    expect(result.credentials).toMatchObject({ refresh_token: 'r1' });
  });

  it('rejects a response without refresh_token', async () => {
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({ tokens: { access_token: 'a' } } as never);
    await expect(connector.completeAuthorization({ code: 'c', redirectUri: REDIRECT, verifier: 'v' })).rejects.toThrow(/refresh_token/);
  });

  it('saves and deletes credentials through the token store', async () => {
    await connector.saveCredentials('me', { refresh_token: 'r1' });
    expect(await store.read('me')).toEqual({ refresh_token: 'r1' });
    await connector.deleteCredentials('me');
    expect(await store.read('me')).toBeNull();
    await expect(connector.deleteCredentials('me')).resolves.toBeUndefined();
  });

  it('lists calendarlist.readonly as missing for an old 4-scope grant', () => {
    const old = GOOGLE_SCOPES.filter((s) => !s.endsWith('calendar.calendarlist.readonly'));
    expect(connector.missingScopes([...old])).toEqual(['https://www.googleapis.com/auth/calendar.calendarlist.readonly']);
    expect(connector.missingScopes([...GOOGLE_SCOPES])).toEqual([]);
  });
});
