import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../domain/model/calendar';
import { EmailAddress } from '../domain/model/email-address';
import type { MailMessage } from '../domain/model/mail';
import type { Task } from '../domain/model/tasks';
import { TimeRange } from '../domain/model/time-range';
import { InMemoryRepositories } from './in-memory-repositories';

const t0 = DateTime.fromISO('2026-11-23T10:00:00Z');

const msg = (id: string, minutes: number): MailMessage => ({
  id, threadId: 't1', accountId: 'acc', from: EmailAddress.parse('a@y.com'), to: [], cc: [], subject: 's',
  date: t0.plus({ minutes }), snippet: '', labels: [],
});

const event = (id: string, hours: number, calendarId = 'cal'): CalendarEvent => ({
  id, accountId: 'acc', calendarId, title: 'e',
  range: new TimeRange(t0.plus({ hours }), t0.plus({ hours: hours + 1 })), allDay: false, blocksTime: true, attendees: [], status: 'confirmed',
});

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, accountId: 'acc', listId: 'l1', title: id, status: 'open', updatedAt: t0, deleted: false, ...extra,
});

describe('InMemoryRepositories id listings', () => {
  it('messageIdsSince returns ids dated at or after since', async () => {
    const repos = new InMemoryRepositories();
    await repos.mail.applyChanges('acc', [msg('old', -1), msg('edge', 0), msg('new', 1)].map((message) => ({ kind: 'upsert' as const, message })));
    expect((await repos.mail.messageIdsSince('acc', t0)).sort()).toEqual(['edge', 'new']);
    expect(await repos.mail.messageIdsSince('other', t0)).toEqual([]);
  });

  it('eventIdsFrom returns ids of the calendar events starting at or after from', async () => {
    const repos = new InMemoryRepositories();
    await repos.events.applyChanges('acc', [event('before', -1), event('edge', 0), event('othercal', 1, 'x')].map((e) => ({ kind: 'upsert' as const, event: e })));
    expect(await repos.events.eventIdsFrom('acc', 'cal', t0)).toEqual(['edge']);
  });

  it('taskIds, completed and lists', async () => {
    const repos = new InMemoryRepositories();
    await repos.tasks.upsertLists('acc', [{ id: 'l1', accountId: 'acc', title: 'Inbox', isDefault: true }]);
    await repos.tasks.applyChanges('acc', 'l1', [
      { kind: 'upsert', task: task('a') },
      { kind: 'upsert', task: task('done', { status: 'completed' }) },
      { kind: 'upsert', task: task('gone', { status: 'completed', deleted: true }) },
    ]);
    await repos.tasks.applyChanges('acc', 'l2', [{ kind: 'upsert', task: task('c', { listId: 'l2' }) }]);
    expect((await repos.tasks.taskIds('acc', 'l1')).sort()).toEqual(['a', 'done', 'gone']);
    expect((await repos.tasks.completed({ accountIds: ['acc'] })).map((t) => t.id)).toEqual(['done']);
    expect(await repos.tasks.lists(['acc'])).toEqual([{ id: 'l1', accountId: 'acc', title: 'Inbox', isDefault: true }]);
    expect(await repos.tasks.lists(['other'])).toEqual([]);
  });
});
