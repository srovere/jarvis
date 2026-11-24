import type { SyncRequests } from '@jarvis/core';
import { eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { accounts } from '../schema';

/** Sync requests stored as `accounts.sync_requested_at` (set to request, null when served). */
export class DrizzleSyncRequests implements SyncRequests {
  constructor(private readonly db: Db) {}

  async pending(): Promise<string[]> {
    const rows = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(isNotNull(accounts.syncRequestedAt))
      .orderBy(accounts.syncRequestedAt);
    return rows.map((r) => r.id);
  }

  async clear(accountId: string): Promise<void> {
    await this.db.update(accounts).set({ syncRequestedAt: null }).where(eq(accounts.id, accountId));
  }

  async request(accountIds: string[]): Promise<void> {
    if (accountIds.length === 0) return;
    await this.db.update(accounts).set({ syncRequestedAt: sql`now()` }).where(inArray(accounts.id, accountIds));
  }
}
