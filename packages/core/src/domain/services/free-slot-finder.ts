import { DateTime } from 'luxon';
import type { CalendarEvent } from '../model/calendar';
import { TimeRange } from '../model/time-range';

export interface WorkSchedule {
  zone: string;
  startHour: number;
  endHour: number;
  /** ISO weekdays, 1 = Monday. */
  workDays: number[];
}

export interface FreeSlotQuery {
  now: DateTime;
  durationMinutes: number;
  busy: CalendarEvent[];
  preferredStartHour?: number;
  horizonWorkDays: number;
}

const ROUND_MS = 15 * 60 * 1000;
/** Safety bound on calendar days scanned when workDays is empty or sparse. */
const MAX_SCAN_DAYS = 400;

export class FreeSlotFinder {
  constructor(private readonly schedule: WorkSchedule) {}

  find(q: FreeSlotQuery): TimeRange | null {
    const { zone, startHour, endHour, workDays } = this.schedule;
    const now = q.now.setZone(zone);
    const roundedMs = Math.ceil(now.toMillis() / ROUND_MS) * ROUND_MS;
    const busy = q.busy
      .filter((e) => e.blocksTime && e.status !== 'cancelled' && e.myResponse !== 'declined')
      .map((e) => e.range)
      .sort((a, b) => a.start.toMillis() - b.start.toMillis());

    let day = now.startOf('day');
    let workDaysSeen = 0;
    for (let i = 0; i < MAX_SCAN_DAYS && workDaysSeen < q.horizonWorkDays; i++, day = day.plus({ days: 1 })) {
      if (!workDays.includes(day.weekday)) continue;
      const first = workDaysSeen === 0;
      workDaysSeen++;

      const fromHour = first ? Math.max(startHour, q.preferredStartHour ?? startHour) : startHour;
      const windowStart = Math.max(day.set({ hour: fromHour }).toMillis(), roundedMs);
      const windowEnd = day.set({ hour: endHour }).toMillis();

      let cursor = windowStart;
      for (const b of busy) {
        const bs = b.start.toMillis();
        const be = b.end.toMillis();
        if (be <= cursor || bs >= windowEnd) continue;
        if (this.fits(cursor, bs, q.durationMinutes)) return this.slot(cursor, q.durationMinutes);
        cursor = Math.max(cursor, be);
      }
      if (this.fits(cursor, windowEnd, q.durationMinutes)) return this.slot(cursor, q.durationMinutes);
    }
    return null;
  }

  private fits(from: number, to: number, durationMinutes: number): boolean {
    return to - from >= durationMinutes * 60_000;
  }

  private slot(startMs: number, durationMinutes: number): TimeRange {
    const start = DateTime.fromMillis(startMs, { zone: this.schedule.zone });
    return new TimeRange(start, start.plus({ minutes: durationMinutes }));
  }
}
