import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailAddress } from '../../domain/model/email-address';
import { PriorityRules } from '../../domain/services/priority-rules';
import { GetDailyBriefing } from './get-daily-briefing';
import { staticSettings, at, event, message, MONDAY_20, task, UseCaseFixture } from './use-case-fixture.test-support';

describe('GetDailyBriefing', () => {
  let f: UseCaseFixture;
  const useCase = () =>
    new GetDailyBriefing(
      f.repos.accounts,
      f.registry,
      f.repos.mail,
      f.repos.events,
      f.repos.tasks,
      new PriorityRules(f.repos.personLinks),
      f.cleaner,
      f.clock,
      staticSettings(),
    );

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
  });

  it('dateOffsetDays 1 on Monday 20:00 returns Tuesday events, excluding declined and cancelled, sorted', async () => {
    await f.repos.events.applyChanges('a1', [
      { kind: 'upsert', event: event('mon', 'a1', '2026-11-23T10:00:00', '2026-11-23T11:00:00') },
      { kind: 'upsert', event: event('tue-late', 'a1', '2026-11-24T15:00:00', '2026-11-24T16:00:00') },
      {
        kind: 'upsert',
        event: event('tue', 'a1', '2026-11-24T10:00:00', '2026-11-24T11:00:00', {
          videoLink: 'https://meet.test/x',
          attendees: [{ email: EmailAddress.parse('Ana <ana@client.com>'), response: 'accepted', self: false }],
        }),
      },
      { kind: 'upsert', event: event('declined', 'a1', '2026-11-24T12:00:00', '2026-11-24T13:00:00', { myResponse: 'declined' }) },
      { kind: 'upsert', event: event('cancelled', 'a1', '2026-11-24T13:00:00', '2026-11-24T14:00:00', { status: 'cancelled' }) },
      { kind: 'upsert', event: event('wed', 'a1', '2026-11-25T10:00:00', '2026-11-25T11:00:00') },
    ]);

    const b = await useCase().execute({ dateOffsetDays: 1 });

    expect(b.date).toBe('2026-11-24');
    expect(b.events.map((e) => e.id)).toEqual(['tue', 'tue-late']);
    expect(b.events[0]).toEqual({
      id: 'tue',
      title: 'Event tue',
      start: '2026-11-24T10:00:00.000-03:00',
      end: '2026-11-24T11:00:00.000-03:00',
      allDay: false,
      videoLink: 'https://meet.test/x',
      attendees: ['ana@client.com'],
    });
  });

  it('caps priority emails at maxPriorityEmails, with a clean snippet and zoned date', async () => {
    const messages = Array.from({ length: 15 }, (_, i) =>
      message(`m${i}`, `t${i}`, 'a1', MONDAY_20.minus({ hours: i + 1 }), { snippet: 'It&#39;s urgent ' }),
    );
    await f.repos.mail.applyChanges('a1', messages.map((m) => ({ kind: 'upsert' as const, message: m })));

    const b = await useCase().execute({ dateOffsetDays: 0 });

    expect(b.priorityEmails.length).toBeLessThanOrEqual(10);
    expect(b.priorityEmails).toHaveLength(10);
    expect(b.priorityEmails[0]).toEqual({
      threadId: 't0',
      accountId: 'a1',
      from: 'Ana <ana@client.com>',
      subject: 'Subject t0',
      date: '2026-11-23T19:00:00.000-03:00',
      snippet: "It's urgent",
    });
  });

  it('excludes threads whose last message is older than a week before the day', async () => {
    await f.repos.mail.applyChanges('a1', [
      { kind: 'upsert', message: message('old', 'old', 'a1', at('2026-11-15T10:00:00')) },
      { kind: 'upsert', message: message('new', 'new', 'a1', at('2026-11-20T10:00:00')) },
    ]);
    const b = await useCase().execute({ dateOffsetDays: 0 });
    expect(b.priorityEmails.map((e) => e.threadId)).toEqual(['new']);
  });

  it('lists tasks due by the end of the requested day with their list title', async () => {
    await f.repos.tasks.upsertLists('a1', [{ id: 'l1', accountId: 'a1', title: 'Inbox', isDefault: true }]);
    await f.repos.tasks.applyChanges('a1', 'l1', [
      { kind: 'upsert', task: task('due-tue', 'a1', { due: at('2026-11-24T15:00:00') }) },
      { kind: 'upsert', task: task('due-thu', 'a1', { due: at('2026-11-26T15:00:00') }) },
      { kind: 'upsert', task: task('no-due', 'a1') },
    ]);
    const b = await useCase().execute({ dateOffsetDays: 1 });
    expect(b.tasksDue).toEqual([{ id: 'due-tue', accountId: 'a1', title: 'Task due-tue', due: '2026-11-24T15:00:00.000-03:00', list: 'Inbox' }]);
  });

  it('lists up to 5 open tasks due in the 7 days after the requested day as tasksUpcoming, soonest first', async () => {
    await f.repos.tasks.upsertLists('a1', [{ id: 'l1', accountId: 'a1', title: 'Inbox', isDefault: true }]);
    // The requested day is Tuesday 2026-11-24; its 7 following days end at Wednesday 2026-12-02 00:00.
    const due = { today: '2026-11-24T15:00:00', d1: '2026-11-25T09:00:00', d2: '2026-11-26T09:00:00', d3: '2026-11-27T09:00:00',
      d4: '2026-11-28T09:00:00', d5: '2026-11-29T09:00:00', d7: '2026-12-01T23:00:00', d8: '2026-12-02T00:00:00' };
    await f.repos.tasks.applyChanges('a1', 'l1', [
      ...Object.entries(due).reverse().map(([id, when]) => ({ kind: 'upsert' as const, task: task(id, 'a1', { due: at(when) }) })),
      { kind: 'upsert', task: task('no-due', 'a1') },
    ]);
    const b = await useCase().execute({ dateOffsetDays: 1 });
    expect(b.tasksDue.map((t) => t.id)).toEqual(['today']);
    expect(b.tasksUpcoming.map((t) => t.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(b.tasksUpcoming[0]).toEqual({ id: 'd1', accountId: 'a1', title: 'Task d1', due: '2026-11-25T09:00:00.000-03:00', list: 'Inbox' });
  });

  it('tasksUpcoming reaches the last of the 7 days but not the day after', async () => {
    await f.repos.tasks.upsertLists('a1', [{ id: 'l1', accountId: 'a1', title: 'Inbox', isDefault: true }]);
    await f.repos.tasks.applyChanges('a1', 'l1', [
      { kind: 'upsert', task: task('d7', 'a1', { due: at('2026-12-01T23:00:00') }) },
      { kind: 'upsert', task: task('d8', 'a1', { due: at('2026-12-02T00:00:00') }) },
    ]);
    expect((await useCase().execute({ dateOffsetDays: 1 })).tasksUpcoming.map((t) => t.id)).toEqual(['d7']);
  });

  it('lists accounts needing re-auth and leaves their data out', async () => {
    await f.addAccount('a2', 'needs_reauth');
    await f.repos.events.applyChanges('a2', [{ kind: 'upsert', event: event('other', 'a2', '2026-11-24T10:00:00', '2026-11-24T11:00:00') }]);
    const b = await useCase().execute({ dateOffsetDays: 1 });
    expect(b.accountsNeedingReauth).toEqual(['a2']);
    expect(b.events).toEqual([]);
  });

  it('one account failing to report its own addresses still yields both accounts priority emails', async () => {
    await f.addAccount('a2');
    vi.spyOn(f.providers.get('a1')!.mail, 'ownAddresses').mockRejectedValue(new Error('network down'));
    await f.repos.mail.applyChanges('a1', [{ kind: 'upsert', message: message('m1', 't1', 'a1', MONDAY_20.minus({ hours: 1 })) }]);
    await f.repos.mail.applyChanges('a2', [{ kind: 'upsert', message: message('n1', 'u1', 'a2', MONDAY_20.minus({ hours: 2 })) }]);

    const b = await useCase().execute({ dateOffsetDays: 0 });

    expect(b.priorityEmails.map((e) => e.threadId)).toEqual(['t1', 'u1']);
    expect((await f.repos.accounts.get('a1')).status).toBe('active');
  });

  it('a task due on Tuesday (start of day in the zone) is in Tuesday tasksDue, not Monday', async () => {
    await f.repos.tasks.upsertLists('a1', [{ id: 'l1', accountId: 'a1', title: 'Inbox', isDefault: true }]);
    await f.repos.tasks.applyChanges('a1', 'l1', [{ kind: 'upsert', task: task('tue', 'a1', { due: at('2026-11-24T00:00:00') }) }]);
    expect((await useCase().execute({ dateOffsetDays: 0 })).tasksDue).toEqual([]);
    expect((await useCase().execute({ dateOffsetDays: 1 })).tasksDue.map((t) => t.id)).toEqual(['tue']);
  });

  describe('freeMinutes', () => {
    const free = async (nowIso: string, offset = 0, overrides = {}) => {
      f.clock.set(at(nowIso));
      const uc = new GetDailyBriefing(
        f.repos.accounts,
        f.registry,
        f.repos.mail,
        f.repos.events,
        f.repos.tasks,
        new PriorityRules(f.repos.personLinks),
        f.cleaner,
        f.clock,
        staticSettings(overrides),
      );
      return (await uc.execute({ dateOffsetDays: offset })).freeMinutes;
    };

    it('is the whole work day (9-19) on a work day before it starts, minus busy time', async () => {
      await f.repos.events.applyChanges('a1', [
        { kind: 'upsert', event: event('m1', 'a1', '2026-11-24T10:00:00', '2026-11-24T11:00:00') },
        { kind: 'upsert', event: event('m2', 'a1', '2026-11-24T10:30:00', '2026-11-24T12:00:00') },
      ]);
      expect(await free('2026-11-24T07:00:00')).toBe(600 - 120);
    });

    it('counts from now when the work day is in progress, clipping events that started earlier', async () => {
      await f.repos.events.applyChanges('a1', [
        { kind: 'upsert', event: event('m1', 'a1', '2026-11-24T10:00:00', '2026-11-24T12:00:00') },
        { kind: 'upsert', event: event('m2', 'a1', '2026-11-24T14:00:00', '2026-11-24T15:00:00') },
      ]);
      expect(await free('2026-11-24T11:00:00')).toBe(8 * 60 - 60 - 60);
    });

    it('is 0 once the work day is over and on a non-work day', async () => {
      expect(await free('2026-11-24T20:00:00')).toBe(0);
      expect(await free('2026-11-28T08:00:00')).toBe(0);
    });

    it('uses the whole work day for a future day and ignores declined, cancelled and non-blocking events', async () => {
      await f.repos.events.applyChanges('a1', [
        { kind: 'upsert', event: event('ok', 'a1', '2026-11-25T09:00:00', '2026-11-25T10:00:00') },
        { kind: 'upsert', event: event('dec', 'a1', '2026-11-25T10:00:00', '2026-11-25T11:00:00', { myResponse: 'declined' }) },
        { kind: 'upsert', event: event('can', 'a1', '2026-11-25T11:00:00', '2026-11-25T12:00:00', { status: 'cancelled' }) },
        { kind: 'upsert', event: event('free', 'a1', '2026-11-25T12:00:00', '2026-11-25T13:00:00', { blocksTime: false }) },
      ]);
      expect(await free('2026-11-24T20:00:00', 1)).toBe(540);
    });

    it('only subtracts events of the account busy calendars', async () => {
      await f.repos.events.applyChanges('a1', [
        { kind: 'upsert', event: event('p', 'a1', '2026-11-24T09:00:00', '2026-11-24T10:00:00') },
        { kind: 'upsert', event: event('o', 'a1', '2026-11-24T10:00:00', '2026-11-24T11:00:00', { calendarId: 'other' }) },
      ]);
      expect(await free('2026-11-24T07:00:00')).toBe(540);
      expect(await free('2026-11-24T07:00:00', 0, { busyCalendars: { a1: ['primary', 'other'] } })).toBe(480);
    });
  });
});
