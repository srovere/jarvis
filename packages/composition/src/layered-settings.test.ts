import { EmailAddress, type Account, type Preferences } from '@jarvis/core';
import { FixedClock, InMemoryRepositories, InMemorySettingsStore } from '@jarvis/core/testing';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { EffectivePreferences, LayeredSettings } from './layered-settings';
import { defaultPreferences } from './app-settings';

const yaml: Preferences = {
  zone: 'Europe/Madrid',
  workSchedule: { startHour: 8, endHour: 17, workDays: [1, 2, 3] },
  focus: { titlePrefix: '[Y] ', horizonWorkDays: 3, defaultDurationMinutes: 60 },
  sync: { intervalMinutes: 7, gmailInitialWindowDays: 30 },
  briefing: { maxPriorityEmails: 4 },
};
const db: Preferences = { ...yaml, zone: 'America/Montevideo', workSchedule: { startHour: 10, endHour: 18, workDays: [1, 2, 3, 4] } };

const account = (id: string, busyCalendars: string[], status: Account['status'] = 'active'): Account => ({
  id,
  provider: 'google',
  email: EmailAddress.parse(`${id}@example.com`),
  status,
  busyCalendars,
  missingScopes: [],
  createdVia: 'wizard',
});

describe('LayeredSettings', () => {
  let store: InMemorySettingsStore;
  let repos: InMemoryRepositories;
  let clock: FixedClock;
  const settings = (preferences: Preferences | null, ttlMs = 5000) =>
    new LayeredSettings(store, repos.accounts, preferences, clock, ttlMs);

  beforeEach(() => {
    store = new InMemorySettingsStore();
    repos = new InMemoryRepositories();
    clock = new FixedClock(DateTime.fromISO('2026-11-23T10:00:00Z'));
  });

  it('prefers the database row over the YAML preferences', async () => {
    await store.save(db);
    const s = await settings(yaml).current();
    expect(s.zone).toBe('America/Montevideo');
    expect(s.workSchedule).toEqual({ zone: 'America/Montevideo', startHour: 10, endHour: 18, workDays: [1, 2, 3, 4] });
    expect(s.focus).toEqual(db.focus);
    expect(s.sync).toEqual({ intervalMinutes: 7, gmailInitialWindowDays: 30 });
  });

  it('falls back to the YAML preferences when nothing was saved', async () => {
    const s = await settings(yaml).current();
    expect(s.zone).toBe('Europe/Madrid');
    expect(s.briefing).toEqual({ maxPriorityEmails: 4 });
  });

  it('falls back to the schema defaults without a row nor a YAML file', async () => {
    const s = await settings(null).current();
    expect(s.zone).toBe(defaultPreferences().zone);
    expect(s.workSchedule).toMatchObject({ startHour: 9, endHour: 19, workDays: [1, 2, 3, 4, 5] });
    expect(s.sync).toEqual({ intervalMinutes: 5, gmailInitialWindowDays: 90 });
  });

  it('reflects a save only after the TTL expires', async () => {
    const provider = settings(yaml, 5000);
    expect((await provider.current()).zone).toBe('Europe/Madrid');
    await store.save(db);
    clock.advance({ seconds: 4 });
    expect((await provider.current()).zone).toBe('Europe/Madrid');
    clock.advance({ seconds: 2 });
    expect((await provider.current()).zone).toBe('America/Montevideo');
  });

  it('builds busy calendars from active accounts, covering the union of two accounts', async () => {
    await repos.accounts.upsert(account('a1', ['primary', 'team']));
    await repos.accounts.upsert(account('a2', ['primary', 'ops']));
    await repos.accounts.upsert(account('gone', ['old'], 'disabled'));
    const s = await settings(yaml).current();
    expect(s.busyCalendars).toEqual({ a1: ['primary', 'team'], a2: ['primary', 'ops'] });
  });

  it('picks up changed busy calendars after the TTL', async () => {
    await repos.accounts.upsert(account('a1', ['primary']));
    const provider = settings(yaml);
    await provider.current();
    await repos.accounts.setBusyCalendars('a1', ['primary', 'team']);
    clock.advance({ seconds: 6 });
    expect((await provider.current()).busyCalendars).toEqual({ a1: ['primary', 'team'] });
  });
});

describe('EffectivePreferences', () => {
  it('prefers the database row, then YAML, then the defaults', async () => {
    const store = new InMemorySettingsStore();
    expect(await new EffectivePreferences(store, null).load()).toEqual(defaultPreferences());
    expect(await new EffectivePreferences(store, yaml).load()).toEqual(yaml);
    await store.save(db);
    expect(await new EffectivePreferences(store, yaml).load()).toEqual(db);
  });
});
