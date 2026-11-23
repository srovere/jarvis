import type { EmailAddress, MailChange, MailMessage, MailRepository, MailThreadSummary } from '@jarvis/core';
import { and, asc, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import type { DateTime } from 'luxon';
import type { Db } from '../db';
import { fromDate, fromStoredAddress, toDate, toStoredAddress } from '../mappers';
import { mailMessages, mailThreads } from '../schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ThreadRow = typeof mailThreads.$inferSelect;
type MessageRow = typeof mailMessages.$inferSelect;

export class DrizzleMailRepository implements MailRepository {
  constructor(private readonly db: Db) {}

  async applyChanges(accountId: string, changes: MailChange[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const c of changes) {
        if (c.kind === 'upsert') await this.upsert(tx, accountId, c.message);
        else await this.remove(tx, accountId, c.messageId);
      }
    });
  }

  async recentThreads(accountId: string, q: { since: DateTime; limit: number }): Promise<MailThreadSummary[]> {
    const threads = await this.db
      .select()
      .from(mailThreads)
      .where(and(eq(mailThreads.accountId, accountId), gte(mailThreads.lastMessageAt, toDate(q.since))))
      .orderBy(desc(mailThreads.lastMessageAt))
      .limit(q.limit);
    return this.summarize(threads);
  }

  async threadsAwaitingReply(accountId: string, own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> {
    const lastMessage = this.db
      .selectDistinctOn([mailMessages.threadId], { threadId: mailMessages.threadId, from: mailMessages.fromAddress })
      .from(mailMessages)
      .where(eq(mailMessages.accountId, accountId))
      .orderBy(mailMessages.threadId, desc(mailMessages.sentAt), desc(mailMessages.id))
      .as('last_message');
    const ownAddresses = own.map((o) => o.address);
    const rows = await this.db
      .select({ thread: mailThreads })
      .from(mailThreads)
      .innerJoin(lastMessage, eq(lastMessage.threadId, mailThreads.id))
      .where(ownAddresses.length > 0 ? notInArray(lastMessage.from, ownAddresses) : undefined)
      .orderBy(desc(mailThreads.lastMessageAt))
      .limit(limit);
    return this.summarize(rows.map((r) => r.thread));
  }

  private async upsert(tx: Tx, accountId: string, m: MailMessage): Promise<void> {
    const [previous] = await tx
      .select({ threadId: mailMessages.threadId })
      .from(mailMessages)
      .where(and(eq(mailMessages.accountId, accountId), eq(mailMessages.externalId, m.id)));

    await tx
      .insert(mailThreads)
      .values({ accountId, externalId: m.threadId, subject: m.subject, lastMessageAt: toDate(m.date) })
      .onConflictDoNothing({ target: [mailThreads.accountId, mailThreads.externalId] });
    const [thread] = await tx
      .select({ id: mailThreads.id })
      .from(mailThreads)
      .where(and(eq(mailThreads.accountId, accountId), eq(mailThreads.externalId, m.threadId)));

    const values = {
      threadId: thread!.id,
      fromAddress: m.from.address,
      fromName: m.from.name ?? null,
      to: m.to.map(toStoredAddress),
      cc: m.cc.map(toStoredAddress),
      subject: m.subject,
      sentAt: toDate(m.date),
      snippet: m.snippet,
      labels: m.labels,
      messageIdHeader: m.messageIdHeader ?? null,
      referencesHeader: m.referencesHeader ?? null,
      raw: m.raw ?? null,
    };
    await tx
      .insert(mailMessages)
      .values({ accountId, externalId: m.id, ...values })
      .onConflictDoUpdate({
        target: [mailMessages.accountId, mailMessages.externalId],
        set: { ...values, updatedAt: sql`now()` },
      });

    await this.recompute(tx, thread!.id);
    if (previous && previous.threadId !== thread!.id) await this.recompute(tx, previous.threadId);
  }

  private async remove(tx: Tx, accountId: string, messageId: string): Promise<void> {
    const deleted = await tx
      .delete(mailMessages)
      .where(and(eq(mailMessages.accountId, accountId), eq(mailMessages.externalId, messageId)))
      .returning({ threadId: mailMessages.threadId });
    for (const d of deleted) await this.recompute(tx, d.threadId);
  }

  /** Derives last_message_at, unread and labels from the thread's messages; drops the thread once it has none. */
  private async recompute(tx: Tx, threadId: string): Promise<void> {
    const messages = await tx
      .select({ sentAt: mailMessages.sentAt, labels: mailMessages.labels })
      .from(mailMessages)
      .where(eq(mailMessages.threadId, threadId));
    if (messages.length === 0) {
      await tx.delete(mailThreads).where(eq(mailThreads.id, threadId));
      return;
    }
    const labels = [...new Set(messages.flatMap((m) => m.labels))];
    await tx
      .update(mailThreads)
      .set({
        lastMessageAt: new Date(Math.max(...messages.map((m) => m.sentAt.getTime()))),
        unread: labels.includes('UNREAD'),
        labels,
        updatedAt: sql`now()`,
      })
      .where(eq(mailThreads.id, threadId));
  }

  private async summarize(threads: ThreadRow[]): Promise<MailThreadSummary[]> {
    if (threads.length === 0) return [];
    const messages = await this.db
      .select()
      .from(mailMessages)
      .where(inArray(mailMessages.threadId, threads.map((t) => t.id)))
      .orderBy(asc(mailMessages.sentAt));
    const byThread = new Map<string, MessageRow[]>();
    for (const m of messages) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    return threads.map((t) => toSummary(t, byThread.get(t.id) ?? []));
  }
}

function toSummary(thread: ThreadRow, messages: MessageRow[]): MailThreadSummary {
  const last = messages[messages.length - 1]!;
  const participants: EmailAddress[] = [];
  for (const m of messages) {
    const addresses = [
      fromStoredAddress({ address: m.fromAddress, ...(m.fromName ? { name: m.fromName } : {}) }),
      ...m.to.map(fromStoredAddress),
      ...m.cc.map(fromStoredAddress),
    ];
    for (const a of addresses) if (!participants.some((p) => p.equals(a))) participants.push(a);
  }
  return {
    id: thread.externalId,
    accountId: thread.accountId,
    subject: thread.subject,
    lastMessageAt: fromDate(thread.lastMessageAt),
    unread: thread.unread,
    labels: thread.labels,
    participants,
    lastFrom: fromStoredAddress({ address: last.fromAddress, ...(last.fromName ? { name: last.fromName } : {}) }),
    snippet: last.snippet,
  };
}
