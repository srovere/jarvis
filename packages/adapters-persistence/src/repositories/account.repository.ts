import { DomainError, EmailAddress, type Account, type AccountRepository } from '@jarvis/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { accounts, mailThreads, calendars, syncState, taskLists } from '../schema';

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Account[]> {
    const rows = await this.db.select().from(accounts).orderBy(accounts.createdAt);
    return rows.map(toAccount);
  }

  async get(id: string): Promise<Account> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id));
    if (!row) throw new DomainError(`Account not found: ${id}`);
    return toAccount(row);
  }

  async upsert(a: Account): Promise<void> {
    const values = {
      provider: a.provider,
      email: a.email.address,
      displayName: a.displayName ?? null,
      status: a.status,
      calendarsBusy: a.busyCalendars,
      missingScopes: a.missingScopes,
      createdVia: a.createdVia,
    };
    await this.db
      .insert(accounts)
      .values({ id: a.id, ...values })
      .onConflictDoUpdate({ target: accounts.id, set: { ...values, updatedAt: sql`now()` } });
  }

  async setStatus(id: string, status: Account['status'], detail?: string): Promise<void> {
    const updated = await this.db
      .update(accounts)
      .set({ status, statusDetail: detail ?? null, updatedAt: sql`now()` })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    if (updated.length === 0) throw new DomainError(`Account not found: ${id}`);
  }

  async findByEmail(email: EmailAddress): Promise<Account | null> {
    const [row] = await this.db.select().from(accounts).where(sql`lower(${accounts.email}) = ${email.address.toLowerCase()}`);
    return row ? toAccount(row) : null;
  }

  async setBusyCalendars(id: string, ids: string[]): Promise<void> {
    await this.update(id, { calendarsBusy: ids });
  }

  async setMissingScopes(id: string, scopes: string[]): Promise<void> {
    await this.update(id, { missingScopes: scopes });
  }

  /** Messages, events and tasks go with their threads, calendars and lists (FK cascade). */
  async deleteData(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(mailThreads).where(eq(mailThreads.accountId, id));
      await tx.delete(calendars).where(eq(calendars.accountId, id));
      await tx.delete(taskLists).where(eq(taskLists.accountId, id));
      await tx.delete(syncState).where(eq(syncState.accountId, id));
    });
  }

  private async update(id: string, set: Partial<typeof accounts.$inferInsert>): Promise<void> {
    const updated = await this.db
      .update(accounts)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    if (updated.length === 0) throw new DomainError(`Account not found: ${id}`);
  }
}

function toAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    provider: row.provider,
    email: EmailAddress.parse(row.email),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    status: row.status,
    busyCalendars: row.calendarsBusy,
    missingScopes: row.missingScopes,
    createdVia: row.createdVia,
  };
}
