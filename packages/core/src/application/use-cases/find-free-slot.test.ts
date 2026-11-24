import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSettings, SettingsProvider } from '../config';
import { appSettings, event, UseCaseFixture } from './use-case-fixture.test-support';
import { FindFreeSlot } from './find-free-slot';

describe('FindFreeSlot', () => {
  let f: UseCaseFixture;
  let current: AppSettings;
  const provider: SettingsProvider = { current: async () => current };
  const useCase = () => new FindFreeSlot(f.repos.accounts, f.repos.events, f.clock, provider);

  beforeEach(async () => {
    current = appSettings({ busyCalendars: { a1: ['primary', 'team'] } });
    f = new UseCaseFixture();
    await f.addAccount('a1');
    await f.repos.events.applyChanges('a1', [
      { kind: 'upsert', event: event('busy', 'a1', '2026-11-24T09:00:00', '2026-11-24T12:00:00') },
      { kind: 'upsert', event: event('team', 'a1', '2026-11-24T12:00:00', '2026-11-24T13:00:00', { calendarId: 'team' }) },
      { kind: 'upsert', event: event('ignored', 'a1', '2026-11-24T13:00:00', '2026-11-24T19:00:00', { calendarId: 'holidays' }) },
    ]);
  });

  it('skips the stored events of the busy calendars and ignores the others', async () => {
    const slot = await useCase().execute({ durationMinutes: 90, preferredStartHour: 10 });
    expect(slot).toEqual({ start: '2026-11-24T13:00:00.000-03:00', end: '2026-11-24T14:30:00.000-03:00' });
  });

  it('uses primary when the account has no busy calendars configured', async () => {
    current = appSettings();
    const slot = await useCase().execute({ durationMinutes: 60 });
    expect(slot).toEqual({ start: '2026-11-24T12:00:00.000-03:00', end: '2026-11-24T13:00:00.000-03:00' });
  });

  it('returns null when there is no slot', async () => {
    expect(await useCase().execute({ durationMinutes: 11 * 60 })).toBeNull();
  });

  it('uses the new work hours on the very next call after settings change', async () => {
    const uc = useCase();
    expect(await uc.execute({ durationMinutes: 60 })).toEqual({
      start: '2026-11-24T13:00:00.000-03:00',
      end: '2026-11-24T14:00:00.000-03:00',
    });
    current = appSettings({
      busyCalendars: { a1: ['primary', 'team'] },
      workSchedule: { zone: current.zone, startHour: 15, endHour: 19, workDays: [1, 2, 3, 4, 5] },
    });
    expect(await uc.execute({ durationMinutes: 60 })).toEqual({
      start: '2026-11-24T15:00:00.000-03:00',
      end: '2026-11-24T16:00:00.000-03:00',
    });
  });

  it('applies a changed time zone to the returned slot on the next call', async () => {
    const uc = useCase();
    await uc.execute({ durationMinutes: 60 });
    current = { ...current, zone: 'Europe/Madrid', workSchedule: { ...current.workSchedule, zone: 'Europe/Madrid' } };
    const slot = await uc.execute({ durationMinutes: 60 });
    expect(slot!.start.endsWith('+01:00')).toBe(true);
  });
});
