import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeSlotFinder } from '../../domain/services/free-slot-finder';
import { appSettings, event, MONDAY_20, UseCaseFixture } from './use-case-fixture.test-support';
import { FindFreeSlot } from './find-free-slot';

describe('FindFreeSlot', () => {
  let f: UseCaseFixture;
  const settings = appSettings({ busyCalendars: { a1: ['primary', 'team'] } });
  const finder = () => new FreeSlotFinder(settings.workSchedule);

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
    await f.repos.events.applyChanges('a1', [
      { kind: 'upsert', event: event('busy', 'a1', '2026-11-24T09:00:00', '2026-11-24T12:00:00') },
      { kind: 'upsert', event: event('team', 'a1', '2026-11-24T12:00:00', '2026-11-24T13:00:00', { calendarId: 'team' }) },
      { kind: 'upsert', event: event('ignored', 'a1', '2026-11-24T13:00:00', '2026-11-24T19:00:00', { calendarId: 'holidays' }) },
    ]);
  });

  it('delegates to FreeSlotFinder with the stored events of the busy calendars', async () => {
    const slotFinder = finder();
    const find = vi.spyOn(slotFinder, 'find');

    const slot = await new FindFreeSlot(f.repos.accounts, f.repos.events, slotFinder, f.clock, settings).execute({
      durationMinutes: 90,
      preferredStartHour: 10,
    });

    expect(find).toHaveBeenCalledTimes(1);
    const q = find.mock.calls[0]![0];
    expect(q.busy.map((e) => e.id)).toEqual(['busy', 'team']);
    expect(q).toMatchObject({ durationMinutes: 90, preferredStartHour: 10, horizonWorkDays: 5 });
    expect(q.now.toMillis()).toBe(MONDAY_20.toMillis());
    expect(slot).toEqual({ start: '2026-11-24T13:00:00.000-03:00', end: '2026-11-24T14:30:00.000-03:00' });
  });

  it('uses primary when the account has no busy calendars configured', async () => {
    const slot = await new FindFreeSlot(f.repos.accounts, f.repos.events, finder(), f.clock, appSettings()).execute({ durationMinutes: 60 });
    expect(slot).toEqual({ start: '2026-11-24T12:00:00.000-03:00', end: '2026-11-24T13:00:00.000-03:00' });
  });

  it('returns null when there is no slot', async () => {
    const slot = await new FindFreeSlot(f.repos.accounts, f.repos.events, finder(), f.clock, settings).execute({ durationMinutes: 11 * 60 });
    expect(slot).toBeNull();
  });
});
