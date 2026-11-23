import 'reflect-metadata';
import { JarvisConfigSchema, type JarvisConfig } from '@jarvis/config';
import { ProviderRegistry, TOKENS, type AppSettings } from '@jarvis/core';
import { FixedClock, InMemoryRepositories } from '@jarvis/core/testing';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import { ProvidersModule } from './providers.module';
import { DB, JARVIS_CONFIG } from './tokens';

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

async function compile() {
  const repos = new InMemoryRepositories();
  const end = vi.fn().mockResolvedValue(undefined);
  const module = await Test.createTestingModule({
    imports: [ProvidersModule.forRoot({ config, configDir: '/etc/jarvis', databaseUrl: 'postgres://unused/db' })],
  })
    .overrideProvider(DB)
    .useValue({ $client: { end } })
    .overrideProvider(TOKENS.AccountRepository)
    .useValue(repos.accounts)
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
  return { module, repos, end };
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

  it('wires use cases to the injected repositories', async () => {
    const { module, repos } = await compile();
    const briefing = module.get(TOKENS.ListTasks) as { execute(q: object): Promise<unknown[]> };
    const list = vi.spyOn(repos.accounts, 'list');
    await expect(briefing.execute({})).resolves.toEqual([]);
    expect(list).toHaveBeenCalled();
    await module.close();
  });

  it('maps the configuration to AppSettings', async () => {
    const { module } = await compile();
    expect(module.get<AppSettings>(TOKENS.AppSettings)).toEqual({
      zone: 'Europe/Madrid',
      workSchedule: { zone: 'Europe/Madrid', startHour: 8, endHour: 17, workDays: [1, 2, 3] },
      focus: { titlePrefix: '[F] ', horizonWorkDays: 3, defaultDurationMinutes: 60 },
      sync: { gmailInitialWindowDays: 30 },
      briefing: { maxPriorityEmails: 4 },
      busyCalendars: { personal: ['primary'], work: ['primary', 'team'] },
    });
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
