import type { Preferences, SettingsStore } from '@jarvis/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';

const SINGLETON_ID = 1;

export class DrizzleSettingsRepository implements SettingsStore {
  constructor(private readonly db: Db) {}

  async load(): Promise<Preferences | null> {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, SINGLETON_ID));
    return row ? (row.data as Preferences) : null;
  }

  async save(p: Preferences): Promise<void> {
    await this.db
      .insert(settings)
      .values({ id: SINGLETON_ID, data: p })
      .onConflictDoUpdate({ target: settings.id, set: { data: p, updatedAt: sql`now()` } });
  }
}
