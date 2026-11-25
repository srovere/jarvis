import type { PendingSyncRequest, SyncRequests } from '@jarvis/core';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { accounts } from '../schema';

/** Sync requests stored as `accounts.sync_requested_at` (set to request, null when served). */
export class DrizzleSyncRequests implements SyncRequests {
  constructor(private readonly db: Db) {}

  async pending(): Promise<PendingSyncRequest[]> {
    const rows = await this.db
      .select({ id: accounts.id, at: accounts.syncRequestedAt })
      .from(accounts)
      .where(isNotNull(accounts.syncRequestedAt))
      .orderBy(accounts.syncRequestedAt);
    return rows.map((r) => ({ accountId: r.id, requestedAt: r.at! }));
  }

  async clear(accountId: string, observedAt: Date): Promise<void> {
    // Postgres keeps microseconds, a JS Date only milliseconds: compare at millisecond precision.
    await this.db
      .update(accounts)
      .set({ syncRequestedAt: null })
      .where(
        and(
          eq(accounts.id, accountId),
          sql`date_trunc('milliseconds', ${accounts.syncRequestedAt}) <= ${observedAt.toISOString()}::timestamptz`,
        ),
      );
  }

  async request(accountIds: string[]): Promise<void> {
    if (accountIds.length === 0) return;
    await this.db.update(accounts).set({ syncRequestedAt: sql`now()` }).where(inArray(accounts.id, accountIds));
  }
}
