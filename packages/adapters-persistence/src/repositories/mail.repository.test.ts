import { EmailAddress, type MailChange, type MailMessage } from '@jarvis/core';
import { count } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { mailMessages, mailThreads } from '../schema';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleMailRepository } from './mail.repository';

const me = EmailAddress.parse('me@example.com');
const ana = EmailAddress.parse('Ana <ana@example.com>');
const t0 = DateTime.fromISO('2026-11-20T10:00:00Z', { zone: 'utc' });

function msg(id: string, threadId: string, from: EmailAddress, minutes: number, extra: Partial<MailMessage> = {}): MailMessage {
  return {
    id,
    threadId,
    accountId: 'personal',
    from,
    to: [me],
    cc: [],
    subject: `Subject ${threadId}`,
    date: t0.plus({ minutes }),
    snippet: `snippet ${id}`,
    labels: ['INBOX'],
    ...extra,
  };
}

const up = (message: MailMessage): MailChange => ({ kind: 'upsert', message });

describe('DrizzleMailRepository', () => {
  const t = useTestDb();
  let repo: DrizzleMailRepository;

  beforeEach(async () => {
    await new DrizzleAccountRepository(t.db()).upsert({ id: 'personal', provider: 'google', email: me, status: 'active' });
    repo = new DrizzleMailRepository(t.db());
  });

  const counts = async () => ({
    threads: (await t.db().select({ n: count() }).from(mailThreads))[0]!.n,
    messages: (await t.db().select({ n: count() }).from(mailMessages))[0]!.n,
  });

  it('upserting the same message twice leaves a single row', async () => {
    await repo.applyChanges('personal', [up(msg('m1', 'th1', ana, 0))]);
    await repo.applyChanges('personal', [up(msg('m1', 'th1', ana, 0))]);
    expect(await counts()).toEqual({ threads: 1, messages: 1 });
  });

  it('delete removes the message and drops the emptied thread', async () => {
    await repo.applyChanges('personal', [up(msg('m1', 'th1', ana, 0))]);
    await repo.applyChanges('personal', [{ kind: 'delete', messageId: 'm1' }]);
    expect(await counts()).toEqual({ threads: 0, messages: 0 });
  });

  it('deleting one message recomputes the thread from the remaining ones', async () => {
    await repo.applyChanges('personal', [
      up(msg('m1', 'th1', ana, 0, { labels: ['INBOX'] })),
      up(msg('m2', 'th1', me, 10, { labels: ['SENT', 'UNREAD'] })),
    ]);
    let [s] = await repo.recentThreads('personal', { since: t0.minus({ days: 1 }), limit: 10 });
    expect(s!.unread).toBe(true);
    expect(s!.labels.sort()).toEqual(['INBOX', 'SENT', 'UNREAD']);
    await repo.applyChanges('personal', [{ kind: 'delete', messageId: 'm2' }]);
    [s] = await repo.recentThreads('personal', { since: t0.minus({ days: 1 }), limit: 10 });
    expect(s!.unread).toBe(false);
    expect(s!.labels).toEqual(['INBOX']);
    expect(s!.lastMessageAt.toMillis()).toBe(t0.toMillis());
  });

  it('summaries aggregate the thread like the in-memory implementation', async () => {
    await repo.applyChanges('personal', [
      up(msg('m1', 'th1', ana, 0, { subject: 'First subject', cc: [EmailAddress.parse('cc@example.com')] })),
      up(msg('m2', 'th1', me, 30, { subject: 'Re: First subject', to: [ana], snippet: 'last one' })),
    ]);
    const [s] = await repo.recentThreads('personal', { since: t0.minus({ hours: 1 }), limit: 5 });
    expect(s).toMatchObject({ id: 'th1', accountId: 'personal', subject: 'First subject', snippet: 'last one' });
    expect(s!.lastFrom.address).toBe('me@example.com');
    expect(s!.lastMessageAt.toMillis()).toBe(t0.plus({ minutes: 30 }).toMillis());
    expect(s!.participants.map((p) => p.address)).toEqual(['ana@example.com', 'me@example.com', 'cc@example.com']);
    expect(s!.participants[0]!.name).toBe('Ana');
  });

  it('recentThreads filters by since, orders newest first and honours limit', async () => {
    await repo.applyChanges('personal', [
      up(msg('a', 'old', ana, -60 * 24 * 10)),
      up(msg('b', 'mid', ana, 5)),
      up(msg('c', 'new', ana, 50)),
    ]);
    const got = await repo.recentThreads('personal', { since: t0.minus({ days: 1 }), limit: 10 });
    expect(got.map((x) => x.id)).toEqual(['new', 'mid']);
    expect(await repo.recentThreads('personal', { since: t0.minus({ days: 1 }), limit: 1 })).toHaveLength(1);
  });

  it('threadsAwaitingReply returns threads whose last message is not mine and excludes the one I answered', async () => {
    await repo.applyChanges('personal', [
      up(msg('a1', 'waiting', ana, 0)),
      up(msg('b1', 'answered', ana, 1)),
      up(msg('b2', 'answered', me, 2)),
    ]);
    const got = await repo.threadsAwaitingReply('personal', [me], 10);
    expect(got.map((x) => x.id)).toEqual(['waiting']);
    expect((await repo.threadsAwaitingReply('personal', [], 10)).map((x) => x.id).sort()).toEqual(['answered', 'waiting']);
  });

  it('does not persist bodies but keeps raw and headers', async () => {
    await repo.applyChanges('personal', [
      up(msg('m1', 'th1', ana, 0, { bodyText: 'SECRET BODY', messageIdHeader: '<x@y>', raw: { a: 1 } })),
    ]);
    const [row] = await t.db().select().from(mailMessages);
    expect(JSON.stringify(row)).not.toContain('SECRET BODY');
    expect(row).toMatchObject({ messageIdHeader: '<x@y>', raw: { a: 1 } });
  });

  it('keeps accounts isolated', async () => {
    await new DrizzleAccountRepository(t.db()).upsert({ id: 'work', provider: 'google', email: me, status: 'active' });
    await repo.applyChanges('personal', [up(msg('m1', 'th1', ana, 0))]);
    expect(await repo.recentThreads('work', { since: t0.minus({ days: 1 }), limit: 10 })).toEqual([]);
  });
});
