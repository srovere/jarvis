import { describe, expect, it } from 'vitest';
import { EmailAddress } from '../../domain/model/email-address';
import type { Preferences } from '../../domain/model/preferences';
import { InMemoryAccountRepository } from '../../testing/in-memory-repositories';
import { InMemorySettingsStore } from '../../testing/in-memory-settings';
import { ImportConfig, type ConfigSeed } from './import-config';

const preferences: Preferences = {
  zone: 'Europe/Madrid',
  workSchedule: { startHour: 9, endHour: 17, workDays: [1, 2, 3, 4, 5] },
  focus: { titlePrefix: 'Focus', horizonWorkDays: 5, defaultDurationMinutes: 90 },
  sync: { intervalMinutes: 7, gmailInitialWindowDays: 30 },
  briefing: { maxPriorityEmails: 5 },
};

const seed: ConfigSeed = {
  preferences,
  accounts: [
    { id: 'personal', provider: 'google', email: 'me@example.com' },
    { id: 'work', provider: 'google', email: 'w@work.example', calendars: ['primary', 'team'] },
  ],
};

function setup() {
  const accounts = new InMemoryAccountRepository();
  const settings = new InMemorySettingsStore();
  return { accounts, settings, useCase: new ImportConfig(accounts, settings) };
}

describe('ImportConfig', () => {
  it('imports accounts and settings into an empty database', async () => {
    const { accounts, settings, useCase } = setup();
    expect(await useCase.execute(seed)).toBe('imported');
    expect(await settings.load()).toEqual(preferences);
    expect(await accounts.get('personal')).toEqual({
      id: 'personal',
      provider: 'google',
      email: EmailAddress.parse('me@example.com'),
      status: 'active',
      busyCalendars: ['primary'],
      missingScopes: [],
      createdVia: 'config',
    });
    expect((await accounts.get('work')).busyCalendars).toEqual(['primary', 'team']);
  });

  it('skips on a second run, leaving dashboard edits untouched', async () => {
    const { accounts, settings, useCase } = setup();
    await useCase.execute(seed);
    await accounts.setBusyCalendars('work', ['only-this']);
    expect(await useCase.execute(seed)).toBe('skipped');
    expect((await accounts.get('work')).busyCalendars).toEqual(['only-this']);
  });

  it('skips when the database already has an account', async () => {
    const { accounts, settings, useCase } = setup();
    await accounts.upsert({
      id: 'wizard',
      provider: 'google',
      email: EmailAddress.parse('x@example.com'),
      status: 'active',
      busyCalendars: ['primary'],
      missingScopes: [],
      createdVia: 'wizard',
    });
    expect(await useCase.execute(seed)).toBe('skipped');
    expect((await accounts.list()).map((a) => a.id)).toEqual(['wizard']);
    expect(await settings.load()).toBeNull();
  });

  it('skips when a settings row already exists', async () => {
    const { accounts, settings, useCase } = setup();
    await settings.save(preferences);
    expect(await useCase.execute(seed)).toBe('skipped');
    expect(await accounts.list()).toEqual([]);
  });
});
