import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB, GOOGLE_CLIENT_STATUS } from '@jarvis/composition';
import { JarvisConfigSchema } from '@jarvis/config';
import { EmailAddress, TOKENS, type Account, type AgentStatus, type Preferences } from '@jarvis/core';
import { InMemoryRepositories, InMemorySettingsStore } from '@jarvis/core/testing';
import type { INestApplication } from '@nestjs/common';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import { Test } from '@nestjs/testing';
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

const account = (id: string, status: Account['status']): Account => ({
  id,
  provider: 'google',
  email: EmailAddress.parse(`${id}@example.com`),
  status,
  busyCalendars: ['primary'],
  missingScopes: [],
  createdVia: 'ui',
});

interface World {
  accounts?: Account[];
  agent?: AgentStatus | null;
  preferences?: Preferences | null;
  googleClient?: 'present' | 'missing';
  webDist?: string;
}

describe('api app', () => {
  const dirs: string[] = [];
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function start(world: World = {}): Promise<number> {
    const repos = new InMemoryRepositories();
    for (const a of world.accounts ?? []) await repos.accounts.upsert(a);
    const settings = new InMemorySettingsStore();
    if (world.preferences) await settings.save(world.preferences);
    const config = JarvisConfigSchema.parse({});
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          configDir: '/nonexistent',
          databaseUrl: 'postgres://unused/db',
          configPresent: false,
          webDist: world.webDist ?? join(tmpdir(), 'jarvis-no-such-dist'),
          mcp: { url: 'http://127.0.0.1:1/mcp', tokenFile: '/nonexistent' },
        }),
      ],
    })
      // A testing module is compiled before an HTTP adapter exists, which would select the no-op loader.
      .overrideProvider(AbstractLoader)
      .useValue(new ExpressLoader())
      .overrideProvider(DB)
      .useValue({ $client: { end: async () => undefined } })
      .overrideProvider(TOKENS.AccountRepository)
      .useValue(repos.accounts)
      .overrideProvider(TOKENS.SettingsStore)
      .useValue(settings)
      .overrideProvider(TOKENS.ConnectAgent)
      .useValue({ status: async () => world.agent ?? null })
      .overrideProvider(GOOGLE_CLIENT_STATUS)
      .useValue({ status: async () => world.googleClient ?? 'missing' })
      .compile();
    app = module.createNestApplication(API_APP_OPTIONS);
    await app.listen(0, '127.0.0.1');
    return Number(new URL(await app.getUrl()).port);
  }

  function webDist(): string {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-web-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Jarvis</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    return dir;
  }

  describe('local-only guard', () => {
    it.each(['127.0.0.1:3000', 'localhost:3000'])('accepts Host %s', async (host) => {
      const port = await start();
      expect((await send(port, 'GET', '/api/health', { host })).json).toEqual({ status: 'ok' });
    });

    it.each(['attacker:3000', '127.0.0.1:3001', 'evil.example'])('rejects Host %s with 403', async (host) => {
      const port = await start();
      expect((await send(port, 'GET', '/api/health', { host })).status).toBe(403);
    });

    it('rejects a foreign Host on static routes too', async () => {
      const port = await start({ webDist: webDist() });
      expect((await send(port, 'GET', '/', { host: 'attacker:3000' })).status).toBe(403);
      expect((await send(port, 'GET', '/assets/app.js', { host: 'attacker:3000' })).status).toBe(403);
    });

    it('rejects a foreign Origin on a state-changing request with 403', async () => {
      const port = await start();
      const r = await send(port, 'POST', '/api/health', { ...GOOD, ...JSON_TYPE, origin: 'http://evil.example' }, '{}');
      expect(r.status).toBe(403);
    });

    it('lets an allowed Origin through the origin check', async () => {
      const port = await start();
      // POST /api/health has no handler: 404 proves the guard passed.
      const r = await send(port, 'POST', '/api/health', { ...GOOD, ...JSON_TYPE, origin: 'http://localhost:3000' }, '{}');
      expect(r.status).toBe(404);
    });

    it('answers 415 to a non-GET request that is not JSON', async () => {
      const port = await start();
      const form = await send(port, 'POST', '/api/health', { ...GOOD, 'content-type': 'application/x-www-form-urlencoded' }, 'a=1');
      const none = await send(port, 'DELETE', '/api/health');
      const text = await send(port, 'POST', '/api/health', { ...GOOD, 'content-type': 'text/plain' }, '{}');
      expect([form.status, none.status, text.status]).toEqual([415, 415, 415]);
    });

    it('accepts application/json with a charset and treats HEAD and OPTIONS like GET', async () => {
      const port = await start();
      const json = await send(port, 'POST', '/api/health', { ...GOOD, 'content-type': 'application/json; charset=utf-8' }, '{}');
      expect(json.status).toBe(404);
      expect((await send(port, 'HEAD', '/api/health')).status).toBe(200);
      expect((await send(port, 'OPTIONS', '/api/health')).status).not.toBe(415);
    });

    it('does not require a content type or check Origin on GET', async () => {
      const port = await start();
      const r = await send(port, 'GET', '/api/health', { ...GOOD, origin: 'http://evil.example' });
      expect(r.status).toBe(200);
    });
  });

  describe('setup status', () => {
    it('reports an empty installation', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/setup/status')).json).toEqual({
        accounts: 0,
        agent: 'none',
        preferencesSaved: false,
        googleClient: 'missing',
      });
    });

    it('counts only accounts that are not disabled and reports agent, preferences and client', async () => {
      const port = await start({
        accounts: [account('a', 'active'), account('b', 'needs_reauth'), account('c', 'disabled')],
        agent: { provider: 'claude', status: 'connected', verifiedAt: '2026-11-24T10:00:00Z' },
        preferences: {} as Preferences,
        googleClient: 'present',
      });
      expect((await send(port, 'GET', '/api/setup/status')).json).toEqual({
        accounts: 2,
        agent: 'connected',
        preferencesSaved: true,
        googleClient: 'present',
      });
    });

    it.each(['failed', 'skipped'] as const)('reports a %s agent', async (status) => {
      const port = await start({ agent: { status, verifiedAt: '2026-11-24T10:00:00Z' } });
      expect((await send(port, 'GET', '/api/setup/status')).json.agent).toBe(status);
    });
  });

  describe('providers', () => {
    it('lists the mail and agent providers', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/providers?kind=mail')).json).toEqual([
        { kind: 'google', label: 'Google (Gmail + Calendar)' },
      ]);
      expect((await send(port, 'GET', '/api/providers?kind=agent')).json).toEqual([
        { kind: 'claude', label: 'Claude (subscription)' },
      ]);
    });

    it('rejects an unknown kind with 400', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/providers?kind=sms')).status).toBe(400);
      expect((await send(port, 'GET', '/api/providers')).status).toBe(400);
    });
  });

  describe('static dashboard', () => {
    it('starts and answers /api when the dist directory does not exist', async () => {
      const port = await start();
      expect((await send(port, 'GET', '/api/health')).status).toBe(200);
    });

    it('serves files and falls back to index.html for SPA routes, never for /api', async () => {
      const port = await start({ webDist: webDist() });
      expect((await send(port, 'GET', '/assets/app.js')).body).toBe('console.log(1)');
      const spa = await send(port, 'GET', '/settings/accounts');
      expect(spa.status).toBe(200);
      expect(spa.body).toContain('<title>Jarvis</title>');
      const missing = await send(port, 'GET', '/api/nope');
      expect(missing.status).toBe(404);
      expect(missing.body).not.toContain('<title>Jarvis</title>');
    });
  });
});
