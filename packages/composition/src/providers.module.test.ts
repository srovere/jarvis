import 'reflect-metadata';
import { JarvisConfigSchema, type JarvisConfig } from '@jarvis/config';
import { EmailAddress, ProviderRegistry, TOKENS, type SettingsProvider } from '@jarvis/core';
import { FixedClock, InMemoryRepositories, InMemorySettingsStore } from '@jarvis/core/testing';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGoogleAuth, ProvidersModule } from './providers.module';
import { DB, GOOGLE_CLIENT_STATUS, JARVIS_CONFIG, type GoogleClientStatus } from './tokens';

const config: JarvisConfig = JarvisConfigSchema.parse({
  timezone: 'Europe/Madrid',
  workSchedule: { startHour: 8, endHour: 17, workDays: [1, 2, 3] },
  focus: { titlePrefix: '[F] ', horizonWorkDays: 3, defaultDurationMinutes: 60 },
  sync: { intervalMinutes: 7, gmailInitialWindowDays: 30 },
  briefing: { maxPriorityEmails: 4 },
  accounts: [
    { id: 'personal', provider: 'google', email: 'me@example.com' },
    { id: 'work', provider: 'google', email: 'me@work.example', calendars: ['primary', 'team'] },
  ],
});

async function compile(configPresent = true) {
  const repos = new InMemoryRepositories();
  const store = new InMemorySettingsStore();
  const end = vi.fn().mockResolvedValue(undefined);
  const module = await Test.createTestingModule({
    imports: [ProvidersModule.forRoot({ config, configDir: '/etc/jarvis', databaseUrl: 'postgres://unused/db', configPresent })],
  })
    .overrideProvider(DB)
    .useValue({ $client: { end } })
    .overrideProvider(TOKENS.AccountRepository)
    .useValue(repos.accounts)
    .overrideProvider(TOKENS.SettingsStore)
    .useValue(store)
    .overrideProvider(TOKENS.SyncStateRepository)
    .useValue(repos.syncState)
    .overrideProvider(TOKENS.MailRepository)
    .useValue(repos.mail)
    .overrideProvider(TOKENS.EventRepository)
    .useValue(repos.events)
    .overrideProvider(TOKENS.TaskRepository)
    .useValue(repos.tasks)
    .overrideProvider(TOKENS.PersonLinkLookup)
    .useValue(repos.personLinks)
    .overrideProvider(TOKENS.ProviderRegistry)
    .useValue(new ProviderRegistry())
    .overrideProvider(TOKENS.Clock)
    .useValue(new FixedClock(DateTime.fromISO('2026-11-23T10:00:00Z')))
    .compile();
  return { module, repos, store, end };
}

describe('ProvidersModule', () => {
  it('resolves every token', async () => {
    const { module } = await compile();
    for (const [name, token] of Object.entries(TOKENS)) {
      expect(module.get(token), name).toBeDefined();
    }
    expect(module.get(JARVIS_CONFIG)).toBe(config);
    await module.close();
  });

  it('exposes the mail provider list and the Google client status', async () => {
    const { module } = await compile();
    expect(module.get(TOKENS.MailProviders)).toEqual([{ kind: 'google', label: 'Google (Gmail + Calendar)' }]);
    expect(['present', 'missing']).toContain(await (module.get(GOOGLE_CLIENT_STATUS) as GoogleClientStatus).status());
    await module.close();
  });

  it('exposes the Claude agent runner and the provider list', async () => {
    const { module } = await compile();
    expect((module.get(TOKENS.AgentRunners) as Array<{ kind: string }>).map((r) => r.kind)).toEqual(['claude']);
    expect(module.get(TOKENS.AgentProviders)).toEqual([{ kind: 'claude', label: 'Claude (subscription)' }]);
    await module.close();
  });

  it('boots without a YAML file and resolves settings from the defaults, not the config layer', async () => {
    const { module } = await compile(false);
    const settings = module.get(TOKENS.SettingsProvider) as SettingsProvider;
    expect((await settings.current()).sync.intervalMinutes).toBe(JarvisConfigSchema.parse({}).sync.intervalMinutes);
    await module.close();
  });

  it('wires use cases to the injected repositories', async () => {
    const { module, repos } = await compile();
    const briefing = module.get(TOKENS.ListTasks) as { execute(q: object): Promise<unknown[]> };
    const list = vi.spyOn(repos.accounts, 'list');
    await expect(briefing.execute({})).resolves.toEqual([]);
    expect(list).toHaveBeenCalled();
    await module.close();
  });

  it('derives settings from the configuration and the active accounts, until preferences are saved', async () => {
    const { module, repos, store } = await compile();
    await repos.accounts.upsert({
      id: 'work',
      provider: 'google',
      email: EmailAddress.parse('me@work.example'),
      status: 'active',
      busyCalendars: ['primary', 'team'],
      missingScopes: [],
      createdVia: 'config',
    });
    const provider = module.get<SettingsProvider>(TOKENS.SettingsProvider);
    expect(await provider.current()).toEqual({
      zone: 'Europe/Madrid',
      workSchedule: { zone: 'Europe/Madrid', startHour: 8, endHour: 17, workDays: [1, 2, 3] },
      focus: { titlePrefix: '[F] ', horizonWorkDays: 3, defaultDurationMinutes: 60 },
      sync: { intervalMinutes: 7, gmailInitialWindowDays: 30 },
      briefing: { maxPriorityEmails: 4 },
      busyCalendars: { work: ['primary', 'team'] },
    });
    expect(await store.load()).toBeNull();
    await module.close();
  });

  it('closes the database when the module shuts down', async () => {
    const { module, end } = await compile();
    expect(end).not.toHaveBeenCalled();
    await module.close();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('uses the real system clock by default', async () => {
    const module = await Test.createTestingModule({
      imports: [ProvidersModule.forRoot({ config, configDir: '/etc/jarvis', databaseUrl: 'postgres://unused/db' })],
    }).compile();
    const before = Date.now();
    const now = module.get<{ now(): DateTime }>(TOKENS.Clock).now().toMillis();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    await module.close();
  });
});

describe('buildGoogleAuth', () => {
  it('uses the same OAuth client for browser authorization and for token refresh', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-auth-'));
    const dataDir = join(dir, 'data');
    await mkdir(join(dataDir, 'google'), { recursive: true });
    await writeFile(
      join(dataDir, 'google', 'oauth-client.json'),
      JSON.stringify({ installed: { client_id: 'uploaded-id', client_secret: 'uploaded-secret' } }),
    );
    const cfg = JarvisConfigSchema.parse({ dataDir: join(dir, 'tokens-root'), secretsDir: join(dir, 'secrets') });
    const { connector, flow } = buildGoogleAuth(cfg, dir, dataDir);
    const start = await connector.beginAuthorization({ redirectUri: 'http://127.0.0.1:1/cb' });
    expect(new URL(start.url).searchParams.get('client_id')).toBe('uploaded-id');
    await connector.saveCredentials('ana', { refresh_token: 'r' });
    const client = await flow.client('ana');
    expect(client._clientId).toBe('uploaded-id');
    expect(client._clientSecret).toBe('uploaded-secret');
  });
});
