import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../domain/errors';
import type { CalendarEvent } from '../domain/model/calendar';
import { EmailAddress } from '../domain/model/email-address';
import type { MailMessage, MailThread } from '../domain/model/mail';
import type { Task } from '../domain/model/tasks';
import { TimeRange } from '../domain/model/time-range';
import { FixedClock } from './fixed-clock';
import { InMemoryCalendarProvider } from './in-memory-calendar-provider';
import { InMemoryMailProvider } from './in-memory-mail-provider';
import { InMemoryRepositories } from './in-memory-repositories';
import { InMemoryTasksProvider } from './in-memory-tasks-provider';

const t0 = DateTime.fromISO('2026-11-23T10:00:00Z');
const a = EmailAddress.parse('a@y.com');
const opts = { initialWindowDays: 90 };

const msg = (id: string, minutes = 0): MailMessage => ({
  id, threadId: 't1', accountId: 'acc', from: a, to: [], cc: [], subject: 's',
  date: t0.plus({ minutes }), snippet: '', labels: [],
});
const thread = (messages: MailMessage[]): MailThread => ({
  id: 't1', accountId: 'acc', subject: 's', messages,
  lastMessageAt: t0, unread: false, labels: [],
});
const event = (id: string): CalendarEvent => ({
  id, accountId: 'acc', calendarId: 'cal', title: 'e',
  range: new TimeRange(t0, t0.plus({ hours: 1 })), allDay: false, blocksTime: true, attendees: [], status: 'confirmed',
});
const task = (id: string): Task => ({
  id, accountId: 'acc', listId: 'l1', title: 't', status: 'open', updatedAt: t0, deleted: false,
});

describe('mail deletes', () => {
  it('removeMessage emits a delete after a cursor', async () => {
    const p = new InMemoryMailProvider({ accountId: 'acc', own: [] });
    p.seed([thread([msg('m1'), msg('m2', 1)])]);
    const { nextCursor } = await p.sync(null, opts);
    p.removeMessage('m1');
    expect((await p.sync(nextCursor, opts)).changes).toEqual([{ kind: 'delete', messageId: 'm1' }]);
    expect((await p.getThread('t1')).messages.map((m) => m.id)).toEqual(['m2']);
  });

  it('re-seeding a thread with fewer messages logs deletes', async () => {
    const p = new InMemoryMailProvider({ accountId: 'acc', own: [] });
    p.seed([thread([msg('m1'), msg('m2', 1)])]);
    const { nextCursor } = await p.sync(null, opts);
    p.seed([thread([msg('m2', 1)])]);
    const changes = (await p.sync(nextCursor, opts)).changes;
    expect(changes).toContainEqual({ kind: 'delete', messageId: 'm1' });
    expect(changes.filter((c) => c.kind === 'delete')).toHaveLength(1);
  });

  it('upsert then delete in one window leaves the repository without the message', async () => {
    const p = new InMemoryMailProvider({ accountId: 'acc', own: [] });
    const { nextCursor } = await p.sync(null, opts);
    p.seed([thread([msg('m1')])]);
    p.removeMessage('m1');
    const repos = new InMemoryRepositories();
    await repos.mail.applyChanges('acc', (await p.sync(nextCursor, opts)).changes);
    expect(await repos.mail.recentThreads('acc', { since: t0.minus({ days: 1 }), limit: 10 })).toEqual([]);
  });

  it('seed rejects a thread without messages', () => {
    const p = new InMemoryMailProvider({ accountId: 'acc', own: [] });
    expect(() => p.seed([thread([])])).toThrow(DomainError);
  });
});

describe('calendar deletes', () => {
  it('removeEvent emits a delete and upsert+delete nets out in the repository', async () => {
    const p = new InMemoryCalendarProvider({ accountId: 'acc' });
    p.seed([event('e1')]);
    const { nextCursor } = await p.sync('cal', null);
    p.removeEvent('cal', 'e1');
    const inc = await p.sync('cal', nextCursor);
    expect(inc.changes).toEqual([{ kind: 'delete', eventId: 'e1', calendarId: 'cal' }]);

    const p2 = new InMemoryCalendarProvider({ accountId: 'acc' });
    const start = await p2.sync('cal', null);
    p2.seed([event('e2')]);
    p2.removeEvent('cal', 'e2');
    const repos = new InMemoryRepositories();
    await repos.events.applyChanges('acc', (await p2.sync('cal', start.nextCursor)).changes);
    expect(await repos.events.inRange(['acc'], new TimeRange(t0.minus({ days: 1 }), t0.plus({ days: 1 })))).toEqual([]);
  });
});

describe('tasks deletes', () => {
  it('removeTask emits a delete and upsert+delete nets out in the repository', async () => {
    const p = new InMemoryTasksProvider({ accountId: 'acc', clock: new FixedClock(t0) });
    p.seed([], [task('k1')]);
    const { nextCursor } = await p.sync('l1', null);
    p.removeTask('l1', 'k1');
    expect((await p.sync('l1', nextCursor)).changes).toEqual([{ kind: 'delete', taskId: 'k1' }]);

    const p2 = new InMemoryTasksProvider({ accountId: 'acc', clock: new FixedClock(t0) });
    const start = await p2.sync('l1', null);
    p2.seed([], [task('k2')]);
    p2.removeTask('l1', 'k2');
    const repos = new InMemoryRepositories();
    await repos.tasks.applyChanges('acc', 'l1', (await p2.sync('l1', start.nextCursor)).changes);
    expect(await repos.tasks.open({ accountIds: ['acc'] })).toEqual([]);
  });
});
