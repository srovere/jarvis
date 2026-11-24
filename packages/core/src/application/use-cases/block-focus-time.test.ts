import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../../domain/errors';
import { FocusSlotSearch } from '../focus-slot-search';
import { at, staticSettings, event, UseCaseFixture } from './use-case-fixture.test-support';
import { BlockFocusTime } from './block-focus-time';

describe('BlockFocusTime', () => {
  let f: UseCaseFixture;
  const settings = staticSettings();
  const build = () =>
    new BlockFocusTime(
      f.repos.accounts,
      f.repos.events,
      new FocusSlotSearch(f.repos.accounts, f.repos.events, f.clock),
      f.registry,
      settings,
    );

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
  });

  it('creates the focus block in the first free slot and stores it', async () => {
    const r = await build().execute({ taskName: 'Refactor auth' });
    expect(r).toEqual({
      status: 'created',
      eventId: 'event-1',
      start: '2026-11-24T09:00:00.000-03:00',
      end: '2026-11-24T10:30:00.000-03:00',
      htmlLink: 'https://calendar.test/event-1',
    });
    const stored = await f.repos.events.inRange(['a1'], event('x', 'a1', '2026-11-24T00:00:00', '2026-11-25T00:00:00').range);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ title: '[Focus] Refactor auth', calendarId: 'primary', myResponse: 'accepted', allDay: false });
  });

  it('returns already_exists on a second call the same day without creating another event', async () => {
    await build().execute({ taskName: 'Refactor auth' });
    const second = await build().execute({ taskName: 'Refactor auth' });
    expect(second).toEqual({
      status: 'already_exists',
      eventId: 'event-1',
      start: '2026-11-24T09:00:00.000-03:00',
      end: '2026-11-24T10:30:00.000-03:00',
    });
    const all = await f.providers.get('a1')!.calendar.listEvents(
      event('x', 'a1', '2026-11-24T00:00:00', '2026-11-26T00:00:00').range,
      ['primary'],
    );
    expect(all).toHaveLength(1);
  });

  it('creates a block for a different task the same day', async () => {
    await build().execute({ taskName: 'A' });
    const r = await build().execute({ taskName: 'B' });
    expect(r).toMatchObject({ status: 'created', start: '2026-11-24T10:30:00.000-03:00' });
  });

  it('returns no_slot when the horizon is full', async () => {
    const days = ['24', '25', '26', '27'];
    await f.repos.events.applyChanges('a1', [
      ...days.map((d) => ({ kind: 'upsert' as const, event: event(`d${d}`, 'a1', `2026-11-${d}T09:00:00`, `2026-11-${d}T19:00:00`) })),
      { kind: 'upsert', event: event('d30', 'a1', '2026-11-30T09:00:00', '2026-11-30T19:00:00') },
    ]);
    expect(await build().execute({ taskName: 'X' })).toEqual({ status: 'no_slot', searchedWorkDays: 5 });
  });

  it('respects preferredStartHour and durationMinutes', async () => {
    f.clock.set(at('2026-11-24T08:00:00'));
    const r = await build().execute({ taskName: 'X', preferredStartHour: 14, durationMinutes: 60 });
    expect(r).toMatchObject({ status: 'created', start: '2026-11-24T14:00:00.000-03:00', end: '2026-11-24T15:00:00.000-03:00' });
  });

  describe('idempotency', () => {
    const providerEvents = async () =>
      f.providers.get('a1')!.calendar.listEvents(event('x', 'a1', '2026-11-23T00:00:00', '2026-12-31T00:00:00').range, ['primary', 'other']);
    const seed = (e: ReturnType<typeof event>) => f.repos.events.applyChanges('a1', [{ kind: 'upsert', event: e }]);

    it('(a) is already_exists when the first block filled the last gap of the day', async () => {
      await seed(event('b', 'a1', '2026-11-24T10:30:00', '2026-11-24T19:00:00'));
      const first = await build().execute({ taskName: 'X' });
      expect(first).toMatchObject({ status: 'created', start: '2026-11-24T09:00:00.000-03:00' });
      const second = await build().execute({ taskName: 'X' });
      expect(second).toMatchObject({ status: 'already_exists', eventId: 'event-1' });
      expect(await providerEvents()).toHaveLength(1);
    });

    it('(b) is already_exists, not no_slot, when the first block filled the last gap of the horizon', async () => {
      const full = ['24', '25', '26'].map((d) => event(`d${d}`, 'a1', `2026-11-${d}T09:00:00`, `2026-11-${d}T19:00:00`));
      for (const e of full) await seed(e);
      await seed(event('d27', 'a1', '2026-11-27T10:30:00', '2026-11-27T19:00:00'));
      expect(await build().execute({ taskName: 'X' })).toMatchObject({ status: 'created', start: '2026-11-27T09:00:00.000-03:00' });
      expect(await build().execute({ taskName: 'X' })).toMatchObject({ status: 'already_exists', eventId: 'event-1' });
    });

    it('(c) a past identical block does not prevent a new one', async () => {
      f.clock.set(at('2026-11-24T12:00:00'));
      await seed(event('old', 'a1', '2026-11-24T09:00:00', '2026-11-24T10:30:00', { title: '[Focus] X' }));
      expect(await build().execute({ taskName: 'X' })).toMatchObject({ status: 'created' });
    });

    it('(d) cancelled or declined identical events are ignored', async () => {
      await seed(event('c', 'a1', '2026-11-24T09:00:00', '2026-11-24T10:30:00', { title: '[Focus] X', status: 'cancelled' }));
      await seed(event('d', 'a1', '2026-11-24T10:30:00', '2026-11-24T12:00:00', { title: '[Focus] X', myResponse: 'declined' }));
      expect(await build().execute({ taskName: 'X' })).toMatchObject({ status: 'created' });
    });

    it('(e) an identical event in a non-busy, non-primary calendar is ignored', async () => {
      await seed(event('o', 'a1', '2026-11-24T09:00:00', '2026-11-24T10:30:00', { title: '[Focus] X', calendarId: 'other' }));
      expect(await build().execute({ taskName: 'X' })).toMatchObject({ status: 'created' });
    });
  });

  it('rejects an account that needs reauth, and fails without active accounts', async () => {
    await f.addAccount('a2', 'needs_reauth');
    await expect(build().execute({ taskName: 'X', accountId: 'a2' })).rejects.toThrow(new DomainError('Account not active: a2'));
    const empty = new UseCaseFixture();
    await empty.addAccount('z', 'needs_reauth');
    const b = new BlockFocusTime(
      empty.repos.accounts,
      empty.repos.events,
      new FocusSlotSearch(empty.repos.accounts, empty.repos.events, empty.clock),
      empty.registry,
      settings,
    );
    await expect(b.execute({ taskName: 'X' })).rejects.toThrow('No active accounts');
  });
});
