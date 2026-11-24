import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB } from '@jarvis/composition';
import { JarvisConfigSchema } from '@jarvis/config';
import { EmailAddress, TOKENS } from '@jarvis/core';
import {
  FixedClock,
  InMemoryRepositories,
  InMemorySettingsStore,
  InMemorySyncRequests,
} from '@jarvis/core/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule as McpAppModule } from '../../mcp-server/src/app.module';
import { McpSessions } from '../../mcp-server/src/mcp-sessions';
import { McpClientService } from './mcp-client.service';

const TOKEN = 'client-test-token-0123456789';

describe('McpClientService (against an in-process mcp-server)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-api-mcp-'));
  let app: INestApplication;
  let url: string;
  let sessions: McpSessions;

  beforeAll(async () => {
    writeFileSync(join(dir, 'mcp_token'), `${TOKEN}\n`);
    const config = JarvisConfigSchema.parse({ timezone: 'America/Argentina/Buenos_Aires', mcp: { tokenFile: 'mcp_token' } });
    const repos = new InMemoryRepositories();
    await repos.accounts.upsert({
      id: 'personal',
      provider: 'google',
      email: EmailAddress.parse('me@example.com'),
      status: 'active',
      busyCalendars: ['primary'],
      missingScopes: [],
      createdVia: 'config',
    });
    const module = await Test.createTestingModule({
      imports: [McpAppModule.forRoot({ config, configDir: dir, databaseUrl: 'postgres://unused/db' })],
    })
      .overrideProvider(DB)
      .useValue({ $client: { end: async () => undefined } })
      .overrideProvider(TOKENS.AccountRepository)
      .useValue(repos.accounts)
      .overrideProvider(TOKENS.SettingsStore)
      .useValue(new InMemorySettingsStore())
      .overrideProvider(TOKENS.SyncRequests)
      .useValue(new InMemorySyncRequests())
      .overrideProvider(TOKENS.SyncStateRepository)
      .useValue(repos.syncState)
      .overrideProvider(TOKENS.MailRepository)
      .useValue(repos.mail)
      .overrideProvider(TOKENS.EventRepository)
      .useValue(repos.events)
      .overrideProvider(TOKENS.TaskRepository)
      .useValue(repos.tasks)
      .overrideProvider(TOKENS.Clock)
      .useValue(new FixedClock(DateTime.fromISO('2026-11-23T08:00:00', { zone: 'America/Argentina/Buenos_Aires' })))
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/mcp`.replace('[::1]', '127.0.0.1');
    sessions = app.get(McpSessions);
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const client = (tokenFile = join(dir, 'mcp_token')) => new McpClientService({ url, tokenFile });

  it('returns the structured content of a tool call', async () => {
    const c = client();
    const status = await c.call<{ accounts: Array<{ accountId: string }> }>('get_sync_status', {});
    expect(status.accounts.map((a) => a.accountId)).toEqual(['personal']);
    await c.onModuleDestroy();
  });

  it('maps a tool error to 502 { error } with the tool text only', async () => {
    const c = client();
    const error = await c.call('read_thread', { thread_id: 'missing' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502 });
    const body = (error as { getResponse(): { error: string } }).getResponse();
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error.length).toBeGreaterThan(0);
    await c.onModuleDestroy();
  });

  it('reconnects once when the server lost the session', async () => {
    const c = client();
    await c.call('get_sync_status', {});
    await sessions.beforeApplicationShutdown(); // the server forgets every session, like a restart
    const again = await c.call<{ accounts: unknown[] }>('get_sync_status', {});
    expect(again.accounts).toHaveLength(1);
    await c.onModuleDestroy();
  });

  it('answers 502 when the token is rejected, without leaking it', async () => {
    const bad = join(dir, 'bad_token');
    writeFileSync(bad, 'wrong-token');
    const c = client(bad);
    const error = await c.call('get_sync_status', {}).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502 });
    expect(JSON.stringify((error as { getResponse(): unknown }).getResponse())).not.toContain('wrong-token');
  });
});
