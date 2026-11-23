import type { SyncStateRepository } from '@jarvis/core';
import { and, eq, sql } from 'drizzle-orm';
import type { DateTime } from 'luxon';
import type { Db } from '../db';
import { fromDate, toDate } from '../mappers';
import { syncState } from '../schema';

export class DrizzleSyncStateRepository implements SyncStateRepository {
  constructor(private readonly db: Db) {}

  async get(accountId: string, resource: string): Promise<string | null> {
    return (await this.find(accountId, resource))?.cursor ?? null;
  }

  async set(accountId: string, resource: string, cursor: string, at: DateTime): Promise<void> {
    await this.db
      .insert(syncState)
      .values({ accountId, resource, cursor, lastRunAt: toDate(at) })
      .onConflictDoUpdate({
        target: [syncState.accountId, syncState.resource],
        set: { cursor, lastRunAt: toDate(at), updatedAt: sql`now()` },
      });
  }

  async lastRunAt(accountId: string, resource: string): Promise<DateTime | null> {
    const row = await this.find(accountId, resource);
    return row?.lastRunAt ? fromDate(row.lastRunAt) : null;
  }

  private async find(accountId: string, resource: string) {
    const [row] = await this.db
      .select()
      .from(syncState)
      .where(and(eq(syncState.accountId, accountId), eq(syncState.resource, resource)));
    return row;
  }
}
