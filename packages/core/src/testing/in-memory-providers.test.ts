import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { DomainError, ThreadNotFound } from '../domain/errors';
import { EmailAddress } from '../domain/model/email-address';
import type { MailMessage, MailThread } from '../domain/model/mail';
import { FixedClock } from './fixed-clock';
import { InMemoryMailProvider } from './in-memory-mail-provider';
import { InMemoryTasksProvider } from './in-memory-tasks-provider';

const addr = (s: string) => EmailAddress.parse(s);
const me = addr('me@x.com');
const t0 = DateTime.fromISO('2026-11-23T10:00:00Z');

const msg = (id: string, from: string, to: string[], minutes: number): MailMessage => ({
  id,
  threadId: 't1',
  accountId: 'acc',
  from: addr(from),
  to: to.map(addr),
  cc: [],
  subject: 'Hola',
  date: t0.plus({ minutes }),
  snippet: `snippet ${id}`,
  labels: [],
});

const thread = (messages: MailMessage[], subject = 'Hola'): MailThread => ({
  id: 't1',
  accountId: 'acc',
  subject,
  messages,
  lastMessageAt: messages[messages.length - 1]!.date,
  unread: true,
  labels: ['INBOX'],
});

const provider = (t: MailThread) => {
  const p = new InMemoryMailProvider({ accountId: 'acc', own: [me] });
  p.seed([t]);
  return p;
};

describe('InMemoryMailProvider', () => {
  it('sync(null) is a full resync and later cursors return only newer changes', async () => {
    const p = provider(thread([msg('m1', 'a@y.com', ['me@x.com'], 0)]));
    const full = await p.sync(null, { initialWindowDays: 90 });
    expect(full.fullResync).toBe(true);
    expect(full.changes).toHaveLength(1);
    expect((await p.sync(full.nextCursor, { initialWindowDays: 90 })).changes).toEqual([]);
    p.seed([{ ...thread([msg('m2', 'a@y.com', ['me@x.com'], 5)]), id: 't2' }]);
    const inc = await p.sync(full.nextCursor, { initialWindowDays: 90 });
    expect(inc.fullResync).toBe(false);
    expect(inc.changes.map((c) => (c.kind === 'upsert' ? c.message.id : c.messageId))).toEqual(['m2']);
    expect(Number(inc.nextCursor)).toBeGreaterThan(Number(full.nextCursor));
  });

  it('getThread throws for a missing thread', async () => {
    await expect(provider(thread([msg('m1', 'a@y.com', ['me@x.com'], 0)])).getThread('zz')).rejects.toThrow(
      new ThreadNotFound('zz'),
    );
    await expect(provider(thread([msg('m1', 'a@y.com', ['me@x.com'], 0)])).getThread('zz')).rejects.toThrow(ThreadNotFound);
  });

  it('replies to the last sender and prefixes Re:', async () => {
    const p = provider(thread([msg('m1', 'a@y.com', ['me@x.com'], 0)]));
    const ref = await p.createDraft({ threadId: 't1', body: 'ok' });
    expect(ref.to.map((a) => a.address)).toEqual(['a@y.com']);
    expect(ref.subject).toBe('Re: Hola');
    expect(p.drafts).toHaveLength(1);
  });

  it('replies to the first non-own recipient when the last message is own, without duplicating Re:', async () => {
    const p = provider(thread([msg('m1', 'me@x.com', ['me@x.com', 'b@y.com'], 0)], 're: Hola'));
    const ref = await p.createDraft({ threadId: 't1', body: 'ok' });
    expect(ref.to.map((a) => a.address)).toEqual(['b@y.com']);
    expect(ref.subject).toBe('re: Hola');
  });

  it('requires to or threadId', async () => {
    await expect(provider(thread([msg('m1', 'a@y.com', ['me@x.com'], 0)])).createDraft({ body: 'x' })).rejects.toThrow(DomainError);
  });

  it('listThreads filters by substring, newest first', async () => {
    const p = provider(thread([msg('m1', 'a@y.com', ['me@x.com'], 0)]));
    expect(await p.listThreads({ query: 'HOLA', maxResults: 5 })).toHaveLength(1);
    expect(await p.listThreads({ query: 'nope', maxResults: 5 })).toHaveLength(0);
    expect(await p.listThreads({ query: '', maxResults: 5 })).toHaveLength(1);
  });
});

describe('InMemoryTasksProvider', () => {
  it('completeTask uses the clock and logs a change', async () => {
    const clock = new FixedClock(t0);
    const p = new InMemoryTasksProvider({ accountId: 'acc', clock });
    const list = await p.createList('Inbox');
    expect(list.isDefault).toBe(true);
    const task = await p.createTask(list.id, { title: 'x' });
    const { nextCursor } = await p.sync(list.id, null);
    clock.advance({ hours: 1 });
    const done = await p.completeTask(list.id, task.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt?.toMillis()).toBe(t0.plus({ hours: 1 }).toMillis());
    const inc = await p.sync(list.id, nextCursor);
    expect(inc.changes).toHaveLength(1);
  });
});
