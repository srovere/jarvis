import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CursorExpired, ReauthRequired } from '../../domain/errors';
import { TimeRange } from '../../domain/model/time-range';
import type { AppSettings } from '../config';
import { SyncAccount } from './sync-account';
import { appSettings, at, event, message, MONDAY_20, task, thread, UseCaseFixture } from './use-case-fixture.test-support';

const LIST = { id: 'l1', accountId: 'a1', title: 'Inbox', isDefault: true };

describe('SyncAccount', () => {
  let f: UseCaseFixture;
  let log: ReturnType<typeof vi.fn<(line: string) => void>>;
  const useCase = (settings: AppSettings = appSettings()) =>
    new SyncAccount(f.repos.accounts, f.registry, f.repos.syncState, f.repos.mail, f.repos.events, f.repos.tasks, f.clock, settings, log);
  const week = new TimeRange(at('2026-11-01T00:00:00'), at('2026-12-31T00:00:00'));

  beforeEach(() => {
    f = new UseCaseFixture();
    log = vi.fn<(line: string) => void>();
  });

  async function seeded(id: string) {
    const p = await f.addAccount(id);
    p.mail.seed([thread([message(`${id}-m1`, `${id}-t1`, id, MONDAY_20.minus({ hours: 1 }))])]);
    p.calendar.seed([event(`${id}-e1`, id, '2026-11-24T10:00:00', '2026-11-24T11:00:00')]);
    p.tasks.seed([{ ...LIST, accountId: id }], [task(`${id}-k1`, id)]);
    return p;
  }

  it('syncs mail, the primary calendar and every task list, saving each nextCursor', async () => {
    const p = await seeded('a1');
    const result = await useCase().execute('a1');

    expect(result).toEqual({
      resources: { mail: 'ok', calendar: 'ok', tasks: 'ok' },
      fullResync: ['mail', 'calendar:primary', 'tasks:l1'],
    });
    expect((await f.repos.mail.recentThreads('a1', { since: MONDAY_20.minus({ days: 1 }), limit: 10 })).map((t) => t.id)).toEqual(['a1-t1']);
    expect((await f.repos.events.inRange(['a1'], week)).map((e) => e.id)).toEqual(['a1-e1']);
    expect((await f.repos.tasks.open({ accountIds: ['a1'] })).map((t) => t.id)).toEqual(['a1-k1']);
    expect(await f.repos.tasks.lists(['a1'])).toEqual([LIST]);

    const mailCursor = (await p.mail.sync(null)).nextCursor;
    expect(await f.repos.syncState.get('a1', 'mail')).toBe(mailCursor);
    expect(await f.repos.syncState.get('a1', 'calendar:primary')).toBe((await p.calendar.sync('primary', null)).nextCursor);
    expect(await f.repos.syncState.get('a1', 'tasks:l1')).toBe((await p.tasks.sync('l1', null)).nextCursor);
    expect((await f.repos.syncState.lastRunAt('a1', 'mail'))?.toMillis()).toBe(MONDAY_20.toMillis());
  });

  it('second run is incremental: uses the stored cursor and reports no full resync', async () => {
    const p = await seeded('a1');
    await useCase().execute('a1');
    const sync = vi.spyOn(p.mail, 'sync');
    p.mail.seed([thread([message('a1-m2', 'a1-t2', 'a1', MONDAY_20)])]);

    const result = await useCase().execute('a1');

    expect(result.fullResync).toEqual([]);
    expect(sync.mock.calls[0]![0]).not.toBeNull();
    expect((await f.repos.mail.recentThreads('a1', { since: MONDAY_20.minus({ days: 1 }), limit: 10 })).map((t) => t.id).sort()).toEqual([
      'a1-t1',
      'a1-t2',
    ]);
  });

  it('Review Focus 4: ReauthRequired marks the first account needs_reauth without throwing; the second still syncs', async () => {
    const first = await seeded('a1');
    await seeded('a2');
    vi.spyOn(first.mail, 'sync').mockRejectedValue(new ReauthRequired('a1'));
    const calendarSync = vi.spyOn(first.calendar, 'sync');

    await expect(useCase().execute('a1')).resolves.toBeDefined();
    const second = await useCase().execute('a2');

    expect((await f.repos.accounts.get('a1')).status).toBe('needs_reauth');
    expect(f.repos.accounts.statusDetails.get('a1')).toBe('run pnpm jarvis auth --account a1');
    expect(calendarSync).not.toHaveBeenCalled();
    expect(second.resources).toEqual({ mail: 'ok', calendar: 'ok', tasks: 'ok' });
    expect((await f.repos.accounts.get('a2')).status).toBe('active');
    expect((await f.repos.events.inRange(['a2'], week)).map((e) => e.id)).toEqual(['a2-e1']);
  });

  it('ReauthRequired from a later resource (tasks) also marks needs_reauth', async () => {
    const p = await seeded('a1');
    vi.spyOn(p.tasks, 'listLists').mockRejectedValue(new ReauthRequired('a1'));
    const result = await useCase().execute('a1');
    expect(result.resources).toEqual({ mail: 'ok', calendar: 'ok', tasks: 'error' });
    expect((await f.repos.accounts.get('a1')).status).toBe('needs_reauth');
  });

  it('ReauthRequired while building the provider bundle marks needs_reauth', async () => {
    await seeded('a1');
    vi.spyOn(f.registry, 'forAccount').mockRejectedValue(new ReauthRequired('a1'));
    const result = await useCase().execute('a1');
    expect(result.resources).toEqual({ mail: 'skipped', calendar: 'skipped', tasks: 'skipped' });
    expect((await f.repos.accounts.get('a1')).status).toBe('needs_reauth');
  });

  it('an error in one resource does not prevent the others and is logged with key and message only', async () => {
    const p = await seeded('a1');
    vi.spyOn(p.mail, 'sync').mockRejectedValue(new Error('boom'));

    const result = await useCase().execute('a1');

    expect(result.resources).toEqual({ mail: 'error', calendar: 'ok', tasks: 'ok' });
    expect(await f.repos.syncState.get('a1', 'mail')).toBeNull();
    expect((await f.repos.accounts.get('a1')).status).toBe('active');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
      level: 'error',
      msg: 'sync resource failed',
      accountId: 'a1',
      resource: 'mail',
      error: 'boom',
    });
  });

  it('reports a kind as error when any of its sub-resources fails', async () => {
    const p = await seeded('a1');
    p.tasks.seed([{ id: 'l2', accountId: 'a1', title: 'Other', isDefault: false }], [task('a1-k2', 'a1', { listId: 'l2' })]);
    const real = p.tasks.sync.bind(p.tasks);
    vi.spyOn(p.tasks, 'sync').mockImplementation(async (listId, cursor) => {
      if (listId === 'l1') throw new Error('boom');
      return real(listId, cursor);
    });

    const result = await useCase().execute('a1');

    expect(result.resources.tasks).toBe('error');
    expect(result.fullResync).toContain('tasks:l2');
    expect((await f.repos.tasks.open({ accountIds: ['a1'] })).map((t) => t.id)).toEqual(['a1-k2']);
    expect(JSON.parse(log.mock.calls[0]![0]).resource).toBe('tasks:l1');
  });

  it('skips the kinds the bundle does not provide', async () => {
    const p = await seeded('a1');
    delete p.bundle.tasks;
    delete p.bundle.calendar;
    expect((await useCase().execute('a1')).resources).toEqual({ mail: 'ok', calendar: 'skipped', tasks: 'skipped' });
  });

  it('CursorExpired retries the resource once with a null cursor', async () => {
    const p = await seeded('a1');
    await f.repos.syncState.set('a1', 'mail', 'expired', MONDAY_20);
    const sync = vi.spyOn(p.mail, 'sync');

    const result = await useCase().execute('a1');

    expect(sync.mock.calls.map((c) => c[0])).toEqual(['expired', null]);
    expect(result.resources.mail).toBe('ok');
    expect(result.fullResync).toContain('mail');
    expect(await f.repos.syncState.get('a1', 'mail')).not.toBe('expired');
  });

  it('CursorExpired on the retry is not retried again', async () => {
    const p = await seeded('a1');
    await f.repos.syncState.set('a1', 'mail', 'expired', MONDAY_20);
    const sync = vi.spyOn(p.mail, 'sync').mockRejectedValue(new CursorExpired('gone'));

    const result = await useCase().execute('a1');

    expect(sync).toHaveBeenCalledTimes(2);
    expect(result.resources.mail).toBe('error');
  });

  it('only syncs the busy calendars configured for the account', async () => {
    const p = await seeded('a1');
    p.calendar.seed([
      event('team-e', 'a1', '2026-11-24T12:00:00', '2026-11-24T13:00:00', { calendarId: 'team' }),
      event('holiday-e', 'a1', '2026-11-24T00:00:00', '2026-11-25T00:00:00', { calendarId: 'holidays' }),
    ]);
    const sync = vi.spyOn(p.calendar, 'sync');

    const result = await useCase(appSettings({ busyCalendars: { a1: ['primary', 'team'] } })).execute('a1');

    expect(sync.mock.calls.map((c) => c[0])).toEqual(['primary', 'team']);
    expect(result.fullResync).toEqual(['mail', 'calendar:primary', 'calendar:team', 'tasks:l1']);
    expect((await f.repos.events.inRange(['a1'], week)).map((e) => e.id).sort()).toEqual(['a1-e1', 'team-e']);
  });

  it('full resync deletes stored items absent from the snapshot within the resync window', async () => {
    await seeded('a1');
    const staleMessage = message('stale-m', 'stale-t', 'a1', MONDAY_20.minus({ days: 3 }));
    const oldMessage = message('old-m', 'old-t', 'a1', MONDAY_20.minus({ days: 120 }));
    await f.repos.mail.applyChanges('a1', [
      { kind: 'upsert', message: staleMessage },
      { kind: 'upsert', message: oldMessage },
    ]);
    await f.repos.events.applyChanges('a1', [
      { kind: 'upsert', event: event('stale-e', 'a1', '2026-11-25T10:00:00', '2026-11-25T11:00:00') },
      { kind: 'upsert', event: event('old-e', 'a1', '2026-09-01T10:00:00', '2026-09-01T11:00:00') },
    ]);
    await f.repos.tasks.applyChanges('a1', 'l1', [{ kind: 'upsert', task: task('stale-k', 'a1') }]);

    await useCase().execute('a1');

    expect((await f.repos.mail.messageIdsSince('a1', MONDAY_20.minus({ days: 365 }))).sort()).toEqual(['a1-m1', 'old-m']);
    expect((await f.repos.events.eventIdsFrom('a1', 'primary', at('2026-01-01T00:00:00'))).sort()).toEqual(['a1-e1', 'old-e']);
    expect(await f.repos.tasks.taskIds('a1', 'l1')).toEqual(['a1-k1']);
  });
});
