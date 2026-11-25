import 'reflect-metadata';
import { request, createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, createDb, runMigrations } from '@jarvis/adapters-persistence';
import { SystemClock } from '@jarvis/composition';
import { JarvisConfigSchema } from '@jarvis/config';
import {
  EmailAddress,
  ProviderRegistry,
  TOKENS,
  type AccountConnector,
  type AgentRunner,
  type ProviderBundle,
} from '@jarvis/core';
import { InMemoryCalendarProvider, InMemoryMailProvider, InMemoryTasksProvider } from '@jarvis/core/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { it } from 'vitest';
import { AppModule as McpAppModule } from '../../../mcp-server/src/app.module';
import { API_APP_OPTIONS, AppModule as ApiAppModule } from '../app.module';

/**
 * Serves the real `api` (127.0.0.1:3100) and `mcp-server` (127.0.0.1:3102) in this process for the Playwright smoke
 * test, behind a forward proxy (127.0.0.1:3101) that lets the browser keep using http://127.0.0.1:3000 (the only
 * address the api accepts): real Postgres (testcontainers), simulated Google and Claude. The doubles are chosen here, in the test
 * harness, and never through an environment variable of the production images. Runs until it is killed.
 */

const EMAIL = 'jarvis.e2e@example.com';
const API_PORT = 3100;
const PROXY_PORT = 3101;
const MCP_PORT = 3102;
const MCP_TOKEN = 'smoke-test-mcp-token-0123456789';

/** Sends the browser straight back to the api callback, as Google would after the user accepted. */
class FakeAccountConnector implements AccountConnector {
  readonly kind = 'google' as const;
  async beginAuthorization({ redirectUri }: { redirectUri: string }) {
    const state = `state-${Math.random().toString(36).slice(2)}`;
    return { url: `${redirectUri}?code=fake-code&state=${state}`, state, verifier: 'fake-verifier' };
  }
  async completeAuthorization() {
    return { email: EmailAddress.parse(EMAIL), credentials: {}, grantedScopes: [] as string[] };
  }
  async saveCredentials(): Promise<void> {}
  async deleteCredentials(): Promise<void> {}
  missingScopes(): string[] {
    return [];
  }
}

/** Accepts the pasted token without running the CLI. */
class FakeAgentRunner implements AgentRunner {
  readonly kind = 'claude';
  async verify() {
    return { ok: true as const, latencyMs: 42 };
  }
}

function inMemoryRegistry(accountId: () => string): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register({
    kind: 'google',
    create: async (): Promise<ProviderBundle> => {
      const id = accountId();
      const own = EmailAddress.parse(EMAIL);
      const mail = new InMemoryMailProvider({ accountId: id, own: [own] });
      const calendar = new InMemoryCalendarProvider({ accountId: id });
      calendar.seedCalendars([{ id: EMAIL, title: 'Me', primary: true }]);
      const tasks = new InMemoryTasksProvider({ accountId: id, clock: new SystemClock() });
      return {
        mail,
        calendar,
        tasks,
        identity: mail,
        capabilities: { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true },
      };
    },
  });
  return registry;
}

/** Forwards absolute-URI proxy requests to the api, keeping the browser's own `Host` header. */
function startProxy(): Server {
  return createServer((req, res) => {
    if (req.url?.startsWith('/')) {
      // Not a proxied request: the readiness probe of the Playwright web server.
      res.writeHead(200).end('ok');
      return;
    }
    const target = new URL(req.url ?? '');
    const upstream = request(
      { host: '127.0.0.1', port: API_PORT, method: req.method, path: `${target.pathname}${target.search}`, headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
}

it('serves the simulated stack until it is stopped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-smoke-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'mcp_token'), `${MCP_TOKEN}\n`);
  process.env.JARVIS_DATA_DIR = join(dir, 'data');

  const container = await new PostgreSqlContainer('postgres:17').start();
  const databaseUrl = container.getConnectionUri();
  const migrationDb = createDb(databaseUrl);
  await runMigrations(migrationDb);
  await closeDb(migrationDb);

  const config = JarvisConfigSchema.parse({
    dataDir: join(dir, 'data'),
    mcp: { tokenFile: join(dir, 'mcp_token') },
  });
  const webDist = process.env.JARVIS_WEB_DIST ?? join(process.cwd(), '..', 'web', 'dist');
  // One registry for both apps: the account id is whatever the wizard created.
  const registry = inMemoryRegistry(() => 'jarvis-e2e');

  const mcpModule = await Test.createTestingModule({
    imports: [McpAppModule.forRoot({ config, configDir: dir, databaseUrl, configPresent: false })],
  })
    .overrideProvider(TOKENS.ProviderRegistry)
    .useValue(registry)
    .compile();
  const mcp: INestApplication = mcpModule.createNestApplication();
  await mcp.listen(MCP_PORT, '127.0.0.1');

  const apiModule = await Test.createTestingModule({
    imports: [
      ApiAppModule.forRoot({
        config,
        configDir: dir,
        databaseUrl,
        configPresent: false,
        webDist,
        mcp: { url: `http://127.0.0.1:${MCP_PORT}/mcp`, tokenFile: join(dir, 'mcp_token') },
      }),
    ],
  })
    // A testing module is compiled before an HTTP adapter exists, which would select the no-op static loader.
    .overrideProvider(AbstractLoader)
    .useValue(new ExpressLoader())
    .overrideProvider(TOKENS.ProviderRegistry)
    .useValue(registry)
    .overrideProvider(TOKENS.AccountConnectors)
    .useValue([new FakeAccountConnector()])
    .overrideProvider(TOKENS.AgentRunners)
    .useValue([new FakeAgentRunner()])
    .compile();
  const api: INestApplication = apiModule.createNestApplication(API_APP_OPTIONS);
  await api.listen(API_PORT, '127.0.0.1');

  const proxy = startProxy();
  await new Promise<void>((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve));

  const stop = async () => {
    proxy.close();
    await api.close().catch(() => undefined);
    await mcp.close().catch(() => undefined);
    await container.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop().finally(resolve));
  });
});
