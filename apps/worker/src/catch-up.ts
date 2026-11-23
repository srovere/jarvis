import type { DateTime } from 'luxon';

/** Decides whether a sync is due when the worker starts (it may have been down for a while). */
export class CatchUp {
  static isOverdue(lastRunAt: DateTime | null, now: DateTime, intervalMinutes: number): boolean {
    if (lastRunAt === null) return true;
    return now.diff(lastRunAt, 'minutes').minutes >= intervalMinutes;
  }
}
