import 'reflect-metadata';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { GoogleClientSecretStore } from '@jarvis/adapters-google';
import { DB, EFFECTIVE_PREFERENCES, GOOGLE_CLIENT_STATUS, GOOGLE_CLIENT_STORE, GoogleClientUpload } from '@jarvis/composition';
import { JarvisConfigSchema } from '@jarvis/config';
import {
  ConnectAgent,
  DomainError,
  EmailAddress,
  TOKENS,
  type Account,
  type AccountConnector,
  type AgentCredentialStore,
  type AgentRunner,
  type AgentStatus,
  type AgentStatusStore,
  type Preferences,
} from '@jarvis/core';
import { FixedClock, InMemoryRepositories, InMemorySettingsStore, InMemorySyncRequests } from '@jarvis/core/testing';
import type { INestApplication } from '@nestjs/common';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { afterEach, describe, expect, it } from 'vitest';
import { API_APP_OPTIONS, AppModule } from './app.module';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  json: any;
}

const GOOD = { host: '127.0.0.1:3000' };
const JSON_TYPE = { 'content-type': 'application/json' };
const POST = { ...GOOD, ...JSON_TYPE };

function send(port: number, method: string, path: string, headers: Record<string, string> = GOOD, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString()));
      res.on('end', () => {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const account = (id: string, status: Account['status'] = 'active', extra: Partial<Account> = {}): Account => ({
  id,
  provider: 'google',
  email: EmailAddress.parse(`${id}@example.com`),
  status,
  busyCalendars: ['primary'],
  missingScopes: [],
  createdVia: 'wizard',
  ...extra,
});

const PREFS: Preferences = {
  zone: 'Europe/Madrid',
  workSchedule: { startHour: 8, endHour: 17, workDays: [1, 2, 3, 4, 5] },
  focus: { titlePrefix: '[F] ', horizonWorkDays: 3, defaultDurationMinutes: 60 },
  sync: { intervalMinutes: 7, gmailInitialWindowDays: 30 },
  briefing: { maxPriorityEmails: 4 },
};

const GOOGLE_CLIENT_JSON = JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });

/** Records what the connector was asked; `state` is predictable so tests can call the callback. */
class FakeConnector implements AccountConnector {
  readonly kind = 'google';
  begun = 0;
  saved: string[] = [];
  deleted: string[] = [];
  lastComplete?: { code: string; redirectUri: string; verifier: string };
  email = 'new@example.com';
  missing: string[] = [];

  async beginAuthorization(input: { redirectUri: string }) {
    this.begun += 1;
    return {
      url: `https://accounts.example/auth?redirect_uri=${encodeURIComponent(input.redirectUri)}&state=state-${this.begun}`,
      state: `state-${this.begun}`,
      verifier: `verifier-${this.begun}`,
    };
  }

  async completeAuthorization(input: { code: string; redirectUri: string; verifier: string }) {
    this.lastComplete = input;
    if (input.code === 'bad') throw new Error('token exchange failed for code bad secret-token-value');
    if (input.code === 'domain') throw new DomainError('Grant the Gmail and Calendar permissions');
    return { email: EmailAddress.parse(this.email), credentials: { refresh: 'r' }, grantedScopes: ['x'] };
  }

  async saveCredentials(accountId: string): Promise<void> {
    this.saved.push(accountId);
  }

  async deleteCredentials(accountId: string): Promise<void> {
    this.deleted.push(accountId);
  }

  missingScopes(): string[] {
    return this.missing;
  }
}

class FakeRunner implements AgentRunner {
  readonly kind = 'claude';
  result: { ok: true; latencyMs: number } | { ok: false; reason: string } = { ok: true, latencyMs: 12 };
  async verify() {
    return this.result;
  }
}

class MemoryCredentials implements AgentCredentialStore {
  token: string | null = null;
  async save(token: string): Promise<void> {
    this.token = token;
  }
  async present(): Promise<boolean> {
    return this.token !== null;
  }
  async clear(): Promise<void> {
    this.token = null;
  }
}

class MemoryStatus implements AgentStatusStore {
  value: AgentStatus | null = null;
  async save(s: AgentStatus): Promise<void> {
    this.value = s;
  }
  async load(): Promise<AgentStatus | null> {
    return this.value;
  }
}

describe('api endpoints', () => {
  let app: INestApplication | undefined;
  let repos: InMemoryRepositories;
  let settings: InMemorySettingsStore;
  let connector: FakeConnector;
  let runner: FakeRunner;
  let credentials: MemoryCredentials;
  let statuses: MemoryStatus;
  let clock: FixedClock;
  let clientSaved: string[];
  let clientPresent: boolean;
  let syncRequests: InMemorySyncRequests;
  let syncRequestFails: boolean;
  let clientDir: string | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (clientDir) rmSync(clientDir, { recursive: true, force: true });
    clientDir = undefined;
  });

  async function start(world: { accounts?: Account[]; preferences?: Preferences; yaml?: Preferences; realClient?: boolean } = {}): Promise<number> {
    repos = new InMemoryRepositories();
    for (const a of world.accounts ?? []) await repos.accounts.upsert(a);
    settings = new InMemorySettingsStore();
    if (world.preferences) await settings.save(world.preferences);
    connector = new FakeConnector();
    runner = new FakeRunner();
    credentials = new MemoryCredentials();
    statuses = new MemoryStatus();
    clock = new FixedClock(DateTime.fromISO('2026-11-24T10:00:00Z', { zone: 'utc' }));
    clientSaved = [];
    clientPresent = false;
    syncRequests = new InMemorySyncRequests();
    syncRequestFails = false;
    const fake = () => ({
      status: async () => (clientPresent ? 'present' : 'missing'),
      save: async (json: string) => {
        if (!json.includes('installed')) throw new DomainError('The OAuth client file has no "installed" section');
        clientSaved.push(json);
        clientPresent = true;
      },
    });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: JarvisConfigSchema.parse({}),
          configDir: '/nonexistent',
          databaseUrl: 'postgres://unused/db',
          configPresent: false,
          webDist: join(tmpdir(), 'jarvis-no-such-dist'),
          mcp: { url: 'http://127.0.0.1:1/mcp', tokenFile: '/nonexistent' },
        }),
      ],
    })
      .overrideProvider(AbstractLoader)
      .useValue(new ExpressLoader())
      .overrideProvider(DB)
      .useValue({ $client: { end: async () => undefined } })
      .overrideProvider(TOKENS.AccountRepository)
      .useValue(repos.accounts)
      .overrideProvider(TOKENS.SettingsStore)
      .useValue(settings)
      .overrideProvider(EFFECTIVE_PREFERENCES)
      .useFactory({
        factory: () => ({ load: async () => (await settings.load()) ?? world.yaml ?? PREFS }),
      })
      .overrideProvider(TOKENS.SyncRequests)
      .useFactory({
        factory: () => ({
          pending: () => syncRequests.pending(),
          clear: (id: string, at: Date) => syncRequests.clear(id, at),
          request: async (ids: string[]) => {
            if (syncRequestFails) throw new Error('db down');
            return syncRequests.request(ids);
          },
        }),
      })
      .overrideProvider(TOKENS.Clock)
      .useValue(clock)
      .overrideProvider(TOKENS.AccountConnectors)
      .useValue([connector])
      .overrideProvider(TOKENS.ConnectAgent)
      .useFactory({ factory: () => new ConnectAgent([runner], credentials, statuses, clock) })
      .overrideProvider(GOOGLE_CLIENT_STATUS)
      .useFactory({ factory: () => ({ status: async () => (clientPresent ? 'present' : 'missing') }) })
      .overrideProvider(GOOGLE_CLIENT_STORE)
      .useFactory({
        factory: () => {
          if (!world.realClient) return fake();
          clientDir = mkdtempSync(join(tmpdir(), 'jarvis-api-gc-'));
          return new GoogleClientUpload(new GoogleClientSecretStore({ dataDir: clientDir }));
        },
      })
      .compile();
    app = module.createNestApplication(API_APP_OPTIONS);
    await app.listen(0, '127.0.0.1');
    return Number(new URL(await app.getUrl()).port);
  }

  describe('accounts', () => {
    it('lists accounts with status detail, missing scopes and busy calendars', async () => {
      const port = await start({
        accounts: [
          account('a'),
          account('b', 'needs_reauth', { statusDetail: 'Reconnect', missingScopes: ['tasks'], busyCalendars: ['primary', 'team'] }),
        ],
      });
      const r = await send(port, 'GET', '/api/accounts');
      expect(r.status).toBe(200);
      expect(r.json).toEqual([
        { id: 'a', provider: 'google', email: 'a@example.com', status: 'active', missingScopes: [], busyCalendars: ['primary'] },
        {
          id: 'b',
          provider: 'google',
          email: 'b@example.com',
          status: 'needs_reauth',
          statusDetail: 'Reconnect',
          missingScopes: ['tasks'],
          busyCalendars: ['primary', 'team'],
        },
      ]);
    });

    it('removes an account and keeps its data by default', async () => {
      const port = await start({ accounts: [account('a')] });
      const r = await send(port, 'DELETE', '/api/accounts/a', POST);
      expect(r.status).toBe(204);
      expect((await repos.accounts.get('a')).status).toBe('disabled');
      expect(connector.deleted).toEqual(['a']);
    });

    it('passes deleteData=true through', async () => {
      const port = await start({ accounts: [account('a')] });
      let deleted = false;
      const original = repos.accounts.deleteData.bind(repos.accounts);
      repos.accounts.deleteData = async (id: string) => {
        deleted = true;
        return original(id);
      };
      expect((await send(port, 'DELETE', '/api/accounts/a?deleteData=true', POST)).status).toBe(204);
      expect(deleted).toBe(true);
    });

    it('rejects a bad deleteData value with 400 and an unknown account with 404', async () => {
      const port = await start({ accounts: [account('a')] });
      const bad = await send(port, 'DELETE', '/api/accounts/a?deleteData=maybe', POST);
      expect(bad.status).toBe(400);
      expect(typeof bad.json.error).toBe('string');
      expect((await repos.accounts.get('a')).status).toBe('active');
      const missing = await send(port, 'DELETE', '/api/accounts/zzz', POST);
      expect(missing.status).toBe(404);
      expect(typeof missing.json.error).toBe('string');
    });

    it('sets busy calendars', async () => {
      const port = await start({ accounts: [account('a')] });
      const r = await send(port, 'PUT', '/api/accounts/a/calendars', POST, JSON.stringify({ ids: ['primary', 'team'] }));
      expect(r.status).toBe(204);
      expect((await repos.accounts.get('a')).busyCalendars).toEqual(['primary', 'team']);
    });

    it('rejects an empty or malformed calendar list with 400 and an unknown account with 404', async () => {
      const port = await start({ accounts: [account('a')] });
      for (const body of [{ ids: [] }, { ids: 'primary' }, { ids: [1] }, {}, { ids: [''] }]) {
        const r = await send(port, 'PUT', '/api/accounts/a/calendars', POST, JSON.stringify(body));
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(typeof r.json.error).toBe('string');
      }
      expect((await repos.accounts.get('a')).busyCalendars).toEqual(['primary']);
      const missing = await send(port, 'PUT', '/api/accounts/zzz/calendars', POST, JSON.stringify({ ids: ['primary'] }));
      expect(missing.status).toBe(404);
    });
  });

  describe('google client', () => {
    it('reports status and stores a valid client file', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/google/client')).json).toEqual({ status: 'missing' });
      const put = await send(port, 'PUT', '/api/google/client', POST, JSON.stringify({ json: GOOGLE_CLIENT_JSON }));
      expect(put.status).toBe(204);
      expect(clientSaved).toEqual([GOOGLE_CLIENT_JSON]);
      expect((await send(port, 'GET', '/api/google/client')).json).toEqual({ status: 'present' });
    });

    it('answers 400 with the problem for an invalid file and stores nothing', async () => {
      const port = await start();
      const r = await send(port, 'PUT', '/api/google/client', POST, JSON.stringify({ json: '{"web":{}}' }));
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: 'The OAuth client file has no "installed" section' });
      expect(clientSaved).toEqual([]);
    });

    describe('with the real client store', () => {
      const cases: Array<[string, string, RegExp]> = [
        ['garbage', 'this is not json SECRETGARBAGE', /not valid JSON/],
        ['a missing client_secret', JSON.stringify({ installed: { client_id: 'the-id-value' } }), /client_secret/],
        ['a missing client_id', JSON.stringify({ installed: { client_secret: 'the-secret-value' } }), /client_id/],
        ['a web client', JSON.stringify({ web: { client_id: 'the-id-value', client_secret: 'the-secret-value' } }), /web OAuth client/],
      ];
      it.each(cases)('answers 400 naming the problem for %s and stores nothing', async (_n, json, problem) => {
        const port = await start({ realClient: true });
        const r = await send(port, 'PUT', '/api/google/client', POST, JSON.stringify({ json }));
        expect(r.status).toBe(400);
        expect(r.json.error).toMatch(problem);
        expect(r.body).not.toMatch(/SECRETGARBAGE|the-id-value|the-secret-value/);
        expect(readdirSync(clientDir!)).toEqual([]);
        expect((await send(port, 'GET', '/api/google/client')).json).toEqual({ status: 'missing' });
      });

      it('stores a valid client without returning its content', async () => {
        const port = await start({ realClient: true });
        const r = await send(port, 'PUT', '/api/google/client', POST, JSON.stringify({ json: GOOGLE_CLIENT_JSON }));
        expect(r.status).toBe(204);
        expect((await send(port, 'GET', '/api/google/client')).json).toEqual({ status: 'present' });
      });
    });

    it('answers 400 when json is not a string', async () => {
      const port = await start();
      expect((await send(port, 'PUT', '/api/google/client', POST, JSON.stringify({ json: 5 }))).status).toBe(400);
      expect((await send(port, 'PUT', '/api/google/client', POST, JSON.stringify({}))).status).toBe(400);
    });
  });

  describe('oauth', () => {
    const start302 = async (port: number, query = '') => send(port, 'GET', `/api/oauth/google/start${query}`);
    const REDIRECT = 'http://127.0.0.1:3000/api/oauth/google/callback';

    it('redirects to the provider with the fixed redirect uri', async () => {
      const port = await start();
      clientPresent = true;
      const r = await start302(port, '?returnTo=/settings/accounts');
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe(
        `https://accounts.example/auth?redirect_uri=${encodeURIComponent(REDIRECT)}&state=state-1`,
      );
    });

    it('works when browsing on localhost:3000 and still uses the 127.0.0.1 redirect uri', async () => {
      const port = await start();
      clientPresent = true;
      const r = await send(port, 'GET', '/api/oauth/google/start', { host: 'localhost:3000' });
      expect(r.status).toBe(302);
      expect(r.headers.location).toContain(encodeURIComponent(REDIRECT));
    });

    it('sends the user back with an error when no OAuth client was uploaded', async () => {
      const port = await start();
      const r = await start302(port, '?returnTo=/onboarding');
      expect(r.status).toBe(302);
      expect(r.headers.location).toMatch(/^\/onboarding\?error=/);
      expect(connector.begun).toBe(0);
    });

    it('sends the user back with an error for an unknown provider', async () => {
      const port = await start();
      clientPresent = true;
      const r = await send(port, 'GET', '/api/oauth/nope/start');
      expect(r.status).toBe(302);
      expect(r.headers.location).toMatch(/^\/onboarding\?error=/);
    });

    it('completes the callback, creates the account and returns to the allow-listed page', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port, '?returnTo=/settings/accounts');
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe('/settings/accounts?connected=new');
      expect(connector.lastComplete).toEqual({ code: 'good', redirectUri: REDIRECT, verifier: 'verifier-1' });
      expect((await repos.accounts.get('new')).status).toBe('active');
    });

    it.each([
      ['/elsewhere', '/onboarding'],
      ['https://evil.example/', '/onboarding'],
      ['//evil.example', '/onboarding'],
      ['/onboarding/../x', '/onboarding'],
      ['/settings', '/onboarding'],
      ['/onboarding', '/onboarding'],
      ['/settings/accounts', '/settings/accounts'],
    ])('returnTo %s lands on %s', async (returnTo, expected) => {
      const port = await start();
      clientPresent = true;
      await start302(port, `?returnTo=${encodeURIComponent(returnTo)}`);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toBe(`${expected}?connected=new`);
    });

    it('defaults returnTo to /onboarding', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toBe('/onboarding?connected=new');
    });

    it('treats a state as single use', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      connector.lastComplete = undefined;
      const again = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(again.status).toBe(302);
      expect(again.headers.location).toMatch(/^\/onboarding\?error=/);
      expect(connector.lastComplete).toBeUndefined();
    });

    it('rejects an unknown or missing state without creating anything', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      for (const q of ['?code=good&state=other', '?code=good', '?state=state-1', '']) {
        const r = await send(port, 'GET', `/api/oauth/google/callback${q}`);
        expect(r.status).toBe(302);
        expect(r.headers.location, q).toMatch(/^\/onboarding\?error=/);
      }
      expect(await repos.accounts.list()).toEqual([]);
      expect(connector.saved).toEqual([]);
    });

    it('rejects an expired state after 10 minutes', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port, '?returnTo=/settings/accounts');
      clock.advance({ minutes: 10, seconds: 1 });
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toMatch(/^\/onboarding\?error=/);
      expect(await repos.accounts.list()).toEqual([]);
    });

    it('accepts a state just inside the 10 minute window', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      clock.advance({ minutes: 9, seconds: 59 });
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toBe('/onboarding?connected=new');
    });

    it('redirects an access_denied back to returnTo with a safe message and consumes the state', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port, '?returnTo=/settings/accounts');
      const r = await send(port, 'GET', '/api/oauth/google/callback?error=access_denied&state=state-1');
      expect(r.status).toBe(302);
      const url = new URL(r.headers.location!, 'http://x');
      expect(url.pathname).toBe('/settings/accounts');
      expect(url.searchParams.get('error')).toMatch(/denied|cancel/i);
      expect(url.searchParams.has('connected')).toBe(false);
      expect(await repos.accounts.list()).toEqual([]);
      const again = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(again.headers.location).toMatch(/^\/onboarding\?error=/);
    });

    it('does not echo provider error text or the code in the redirect', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?error=%3Cscript%3Eevil&code=SECRETCODE&state=state-1');
      expect(r.headers.location).not.toContain('evil');
      expect(r.headers.location).not.toContain('SECRETCODE');
    });

    it('shows a generic error when the exchange fails and never leaks the failure detail', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=bad&state=state-1');
      expect(r.status).toBe(302);
      expect(r.headers.location).toMatch(/^\/onboarding\?error=/);
      expect(decodeURIComponent(r.headers.location!)).not.toMatch(/secret-token-value|code bad/);
      expect(await repos.accounts.list()).toEqual([]);
      expect(connector.saved).toEqual([]);
    });

    it('shows the message of a domain error, URL-encoded', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=domain&state=state-1');
      expect(r.headers.location).toBe(`/onboarding?error=${encodeURIComponent('Grant the Gmail and Calendar permissions')}`);
    });

    it('keeps the same account id when reconnecting an existing email', async () => {
      const port = await start({ accounts: [account('new', 'needs_reauth', { statusDetail: 'x' })] });
      clientPresent = true;
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toBe('/onboarding?connected=new');
      expect(await repos.accounts.list()).toHaveLength(1);
      expect((await repos.accounts.get('new')).status).toBe('active');
    });

    it('reconnecting refreshes missing scopes, clears the status detail and keeps synced data', async () => {
      const port = await start({
        accounts: [account('new', 'needs_reauth', { statusDetail: 'Reconnect needed', missingScopes: ['old-scope'] })],
      });
      clientPresent = true;
      await repos.syncState.set('new', 'gmail', 'cursor-1', clock.now());
      connector.missing = ['https://www.googleapis.com/auth/tasks'];
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toBe('/onboarding?connected=new');
      const accounts = await repos.accounts.list();
      expect(accounts).toHaveLength(1);
      const reconnected = await repos.accounts.get('new');
      expect(reconnected.id).toBe('new');
      expect(reconnected.status).toBe('active');
      expect(reconnected.missingScopes).toEqual(['https://www.googleapis.com/auth/tasks']);
      expect(reconnected.statusDetail).toBeUndefined();
      expect(await repos.syncState.get('new', 'gmail')).toBe('cursor-1');
      expect(connector.saved).toEqual(['new']);
    });

    it('requests a sync for the connected account', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect((await syncRequests.pending()).map((r) => r.accountId)).toEqual(['new']);
    });

    it('requests a sync after a reconnect too', async () => {
      const port = await start({ accounts: [account('new', 'needs_reauth', { statusDetail: 'x' })] });
      clientPresent = true;
      await start302(port);
      await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect((await syncRequests.pending()).map((r) => r.accountId)).toEqual(['new']);
    });

    it('still completes the connection when the sync request fails', async () => {
      const port = await start();
      clientPresent = true;
      syncRequestFails = true;
      await start302(port);
      const r = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(r.headers.location).toBe('/onboarding?connected=new');
      expect((await repos.accounts.get('new')).status).toBe('active');
    });

    it('does not request a sync when the connection fails', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port);
      await send(port, 'GET', '/api/oauth/google/callback?code=bad&state=state-1');
      expect(await syncRequests.pending()).toEqual([]);
    });

    it('purges expired entries so they cannot be used and do not accumulate', async () => {
      const port = await start();
      clientPresent = true;
      await start302(port); // state-1
      clock.advance({ minutes: 11 });
      await start302(port); // state-2, purges state-1
      const old = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-1');
      expect(old.headers.location).toMatch(/^\/onboarding\?error=/);
      const fresh = await send(port, 'GET', '/api/oauth/google/callback?code=good&state=state-2');
      expect(fresh.headers.location).toBe('/onboarding?connected=new');
    });
  });

  describe('settings', () => {
    it('returns the effective preferences when nothing is stored', async () => {
      const port = await start({ yaml: PREFS });
      expect((await send(port, 'GET', '/api/settings')).json).toEqual(PREFS);
    });

    it('returns the stored preferences', async () => {
      const stored = { ...PREFS, zone: 'America/New_York' };
      const port = await start({ preferences: stored });
      expect((await send(port, 'GET', '/api/settings')).json.zone).toBe('America/New_York');
    });

    it('saves valid preferences and makes preferencesSaved true', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/setup/status')).json.preferencesSaved).toBe(false);
      const r = await send(port, 'PUT', '/api/settings', POST, JSON.stringify(PREFS));
      expect(r.status).toBe(204);
      expect(await settings.load()).toEqual(PREFS);
      expect((await send(port, 'GET', '/api/setup/status')).json.preferencesSaved).toBe(true);
      expect((await send(port, 'GET', '/api/settings')).json).toEqual(PREFS);
    });

    it('keeps the stored agent status and ignores one sent by the client', async () => {
      const agent: AgentStatus = { provider: 'claude', status: 'connected', verifiedAt: '2026-11-24T10:00:00Z' };
      const port = await start({ preferences: { ...PREFS, agent } });
      await send(port, 'PUT', '/api/settings', POST, JSON.stringify({ ...PREFS, zone: 'UTC', agent: { status: 'failed', verifiedAt: 'x' } }));
      const saved = await settings.load();
      expect(saved?.zone).toBe('UTC');
      expect(saved?.agent).toEqual(agent);
    });

    it('accepts a work day ending at midnight and round-trips a YAML-derived endHour 24', async () => {
      const yaml = { ...PREFS, workSchedule: { startHour: 9, endHour: 24, workDays: [1, 2, 3, 4, 5] } };
      const port = await start({ yaml });
      const got = await send(port, 'GET', '/api/settings');
      expect(got.json.workSchedule.endHour).toBe(24);
      expect((await send(port, 'PUT', '/api/settings', POST, JSON.stringify(got.json))).status).toBe(204);
      expect((await settings.load())?.workSchedule.endHour).toBe(24);
    });

    const bad: Array<[string, (p: any) => unknown]> = [
      ['an invalid time zone', (p) => ({ ...p, zone: 'Mars/Base' })],
      ['a missing field', ({ briefing: _b, ...rest }) => rest],
      ['a non-object body', () => [1]],
      ['startHour above 23', (p) => ({ ...p, workSchedule: { ...p.workSchedule, startHour: 24, endHour: 24 } })],
      ['a negative startHour', (p) => ({ ...p, workSchedule: { ...p.workSchedule, startHour: -1 } })],
      ['endHour above 24', (p) => ({ ...p, workSchedule: { ...p.workSchedule, endHour: 25 } })],
      ['endHour equal to startHour', (p) => ({ ...p, workSchedule: { ...p.workSchedule, startHour: 9, endHour: 9 } })],
      ['endHour before startHour', (p) => ({ ...p, workSchedule: { ...p.workSchedule, startHour: 12, endHour: 9 } })],
      ['a fractional hour', (p) => ({ ...p, workSchedule: { ...p.workSchedule, startHour: 8.5 } })],
      ['empty workDays', (p) => ({ ...p, workSchedule: { ...p.workSchedule, workDays: [] } })],
      ['duplicate workDays', (p) => ({ ...p, workSchedule: { ...p.workSchedule, workDays: [1, 1] } })],
      ['workDays out of range', (p) => ({ ...p, workSchedule: { ...p.workSchedule, workDays: [0, 8] } })],
      ['a non-positive sync interval', (p) => ({ ...p, sync: { ...p.sync, intervalMinutes: 0 } })],
      ['a string number', (p) => ({ ...p, briefing: { maxPriorityEmails: '4' } })],
    ];
    it.each(bad)('answers 400 and stores nothing for %s', async (_name, mutate) => {
      const port = await start();
      const r = await send(port, 'PUT', '/api/settings', POST, JSON.stringify(mutate(structuredClone(PREFS))));
      expect(r.status).toBe(400);
      expect(typeof r.json.error).toBe('string');
      expect(await settings.load()).toBeNull();
    });
  });

  describe('agent', () => {
    it('stores a subscription token without echoing it', async () => {
      const port = await start();
      const r = await send(port, 'PUT', '/api/agent/token', POST, JSON.stringify({ kind: 'claude', token: ' sk-ant-oat01-secret ' }));
      expect(r.status).toBe(204);
      expect(r.body).toBe('');
      expect(credentials.token).toBe('sk-ant-oat01-secret');
    });

    it('rejects an API key, an empty token, an unknown kind and a malformed body with 400, never echoing the token', async () => {
      const port = await start();
      const cases = [
        { kind: 'claude', token: 'sk-ant-api03-LEAKME' },
        { kind: 'claude', token: '   ' },
        { kind: 'openai', token: 'abc' },
        { kind: 'claude', token: 5 },
        { token: 'abc' },
      ];
      for (const body of cases) {
        const r = await send(port, 'PUT', '/api/agent/token', POST, JSON.stringify(body));
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(typeof r.json.error).toBe('string');
        expect(r.body).not.toContain('LEAKME');
      }
      expect(credentials.token).toBeNull();
    });

    it('verifies the agent and records the status', async () => {
      const port = await start();
      const r = await send(port, 'POST', '/api/agent/verify', POST, '{}');
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, latencyMs: 12 });
      expect(statuses.value?.status).toBe('connected');
      expect((await send(port, 'GET', '/api/setup/status')).json.agent).toBe('connected');
    });

    it('reports a failed verification with its reason', async () => {
      const port = await start();
      runner.result = { ok: false, reason: 'not logged in' };
      const r = await send(port, 'POST', '/api/agent/verify', POST, '{}');
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: false, reason: 'not logged in' });
      expect(statuses.value?.status).toBe('failed');
    });

    it('skips the agent step', async () => {
      const port = await start();
      const r = await send(port, 'POST', '/api/agent/skip', POST, '{}');
      expect(r.status).toBe(204);
      expect(statuses.value?.status).toBe('skipped');
    });
  });

  describe('errors', () => {
    it('answers 500 with a generic message when something unexpected fails', async () => {
      const port = await start({ accounts: [account('a')] });
      repos.accounts.setBusyCalendars = async () => {
        throw new Error('connection to db at secret-host refused');
      };
      const r = await send(port, 'PUT', '/api/accounts/a/calendars', POST, JSON.stringify({ ids: ['primary'] }));
      expect(r.status).toBe(500);
      expect(r.json).toEqual({ error: 'Internal error' });
    });

    it('answers unknown routes with an { error } body', async () => {
      const port = await start();
      const r = await send(port, 'GET', '/api/nope');
      expect(r.status).toBe(404);
      expect(typeof r.json.error).toBe('string');
    });

    it('answers malformed JSON from an allowed origin with 400', async () => {
      const port = await start();
      const r = await send(port, 'PUT', '/api/settings', { ...POST, origin: 'http://127.0.0.1:3000' }, '{not json');
      expect(r.status).toBe(400);
      expect(typeof r.json.error).toBe('string');
    });
  });

  describe('local-only guard on mutating endpoints', () => {
    const evil = [
      ['a foreign Origin', { ...POST, origin: 'http://evil.example' }],
      ['Origin: null', { ...POST, origin: 'null' }],
      ['a foreign Host', { host: 'attacker:3000', ...JSON_TYPE }],
    ] as const;

    it.each(evil)('PUT /api/settings with %s gets 403 and saves nothing', async (_n, headers) => {
      const port = await start();
      const r = await send(port, 'PUT', '/api/settings', { ...headers }, JSON.stringify(PREFS));
      expect(r.status).toBe(403);
      expect(await settings.load()).toBeNull();
    });

    it.each(evil)('DELETE /api/accounts/:id with %s gets 403 and keeps the account', async (_n, headers) => {
      const port = await start({ accounts: [account('a')] });
      const r = await send(port, 'DELETE', '/api/accounts/a', { ...headers });
      expect(r.status).toBe(403);
      expect((await repos.accounts.get('a')).status).toBe('active');
      expect(connector.deleted).toEqual([]);
    });

    it.each(evil)('PUT /api/agent/token with %s gets 403 and stores nothing', async (_n, headers) => {
      const port = await start();
      const r = await send(port, 'PUT', '/api/agent/token', { ...headers }, JSON.stringify({ kind: 'claude', token: 'tok' }));
      expect(r.status).toBe(403);
      expect(credentials.token).toBeNull();
    });

    it('answers a foreign-Origin POST with a malformed body 403, not 400 (guard runs before body parsing)', async () => {
      const port = await start();
      for (const body of ['{not json', '']) {
        const r = await send(port, 'POST', '/api/agent/verify', { ...POST, origin: 'http://evil.example' }, body);
        expect(r.status).toBe(403);
      }
      const attacker = await send(port, 'POST', '/api/agent/verify', { host: 'attacker:3000', ...JSON_TYPE }, '{not json');
      expect(attacker.status).toBe(403);
    });

    it('answers a foreign Host on GET /api/settings with 403', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/settings', { host: 'attacker:3000' })).status).toBe(403);
    });
  });
});
