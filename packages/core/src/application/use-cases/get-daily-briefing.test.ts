import { beforeEach, describe, expect, it } from 'vitest';
import { EmailAddress } from '../../domain/model/email-address';
import { PriorityRules } from '../../domain/services/priority-rules';
import { GetDailyBriefing } from './get-daily-briefing';
import { appSettings, at, event, message, MONDAY_20, task, UseCaseFixture } from './use-case-fixture.test-support';

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
      appSettings(),
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
    expect(b.tasksDue).toEqual([{ id: 'due-tue', title: 'Task due-tue', due: '2026-11-24T15:00:00.000-03:00', list: 'Inbox' }]);
  });

  it('lists accounts needing re-auth and leaves their data out', async () => {
    await f.addAccount('a2', 'needs_reauth');
    await f.repos.events.applyChanges('a2', [{ kind: 'upsert', event: event('other', 'a2', '2026-11-24T10:00:00', '2026-11-24T11:00:00') }]);
    const b = await useCase().execute({ dateOffsetDays: 1 });
    expect(b.accountsNeedingReauth).toEqual(['a2']);
    expect(b.events).toEqual([]);
  });
});
