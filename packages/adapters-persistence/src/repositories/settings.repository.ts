import type { Preferences, SettingsStore } from '@jarvis/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';

const SINGLETON_ID = 1;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isPositiveInt = (v: unknown): v is number => isInt(v) && v > 0;

/** Structural check of a stored document; rows written by an older or hand-edited shape must not reach the use cases. */
function isPreferences(v: unknown): v is Preferences {
  if (!isObject(v)) return false;
  const { zone, workSchedule: w, focus: f, sync: s, briefing: b } = v;
  return (
    typeof zone === 'string' &&
    isObject(w) &&
    isInt(w.startHour) &&
    isInt(w.endHour) &&
    Array.isArray(w.workDays) &&
    w.workDays.length > 0 &&
    w.workDays.every((d) => isInt(d) && d >= 1 && d <= 7) &&
    isObject(f) &&
    typeof f.titlePrefix === 'string' &&
    isPositiveInt(f.horizonWorkDays) &&
    isPositiveInt(f.defaultDurationMinutes) &&
    isObject(s) &&
    isPositiveInt(s.intervalMinutes) &&
    isPositiveInt(s.gmailInitialWindowDays) &&
    isObject(b) &&
    isPositiveInt(b.maxPriorityEmails)
  );
}

export class DrizzleSettingsRepository implements SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  /** `null` when never saved, or when the stored row is malformed (warned about, without its content). */
  async load(): Promise<Preferences | null> {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, SINGLETON_ID));
    if (!row) return null;
    if (!isPreferences(row.data)) {
      this.log(JSON.stringify({ level: 'warn', msg: 'ignoring malformed settings row; using configuration defaults' }));
      return null;
    }
    return row.data;
  }

  async save(p: Preferences): Promise<void> {
    await this.db
      .insert(settings)
      .values({ id: SINGLETON_ID, data: p })
      .onConflictDoUpdate({ target: settings.id, set: { data: p, updatedAt: sql`now()` } });
  }
}
