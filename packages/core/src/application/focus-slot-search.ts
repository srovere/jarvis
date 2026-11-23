import type { DateTime } from 'luxon';
import { TimeRange } from '../domain/model/time-range';
import type { Clock } from '../domain/ports/clock';
import type { AccountRepository, EventRepository } from '../domain/ports/repositories';
import type { FreeSlotFinder } from '../domain/services/free-slot-finder';
import { activeAccounts } from './active-accounts';
import { busyCalendarsOf, type AppSettings } from './config';

/** Same bound as `FreeSlotFinder` on the calendar days it scans. */
const MAX_SCAN_DAYS = 400;

/** First free work slot within the focus horizon; busy = stored events of each active account's busy calendars. */
export class FocusSlotSearch {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: EventRepository,
    private readonly finder: FreeSlotFinder,
    private readonly clock: Clock,
    private readonly settings: AppSettings,
  ) {}

  async find(q: { durationMinutes: number; preferredStartHour?: number }): Promise<TimeRange | null> {
    const now = this.clock.now();
    const horizonWorkDays = this.settings.focus.horizonWorkDays;
    const active = await activeAccounts(this.accounts);
    const stored = await this.events.inRange(
      active.map((a) => a.id),
      this.horizon(),
    );
    const busy = stored.filter((e) => busyCalendarsOf(this.settings, e.accountId).includes(e.calendarId));
    return this.finder.find({
      now,
      durationMinutes: q.durationMinutes,
      busy,
      ...(q.preferredStartHour !== undefined ? { preferredStartHour: q.preferredStartHour } : {}),
      horizonWorkDays,
    });
  }

  /** From now to the end of the last work day the finder may scan. */
  horizon(): TimeRange {
    const now = this.clock.now();
    return new TimeRange(now, this.horizonEnd(now, this.settings.focus.horizonWorkDays));
  }

  /** Start of the day after the last work day the finder may scan. */
  private horizonEnd(now: DateTime, horizonWorkDays: number): DateTime {
    const { zone, workDays } = this.settings.workSchedule;
    let day = now.setZone(zone).startOf('day');
    for (let i = 0, seen = 0; i < MAX_SCAN_DAYS && seen < horizonWorkDays; i++, day = day.plus({ days: 1 })) {
      if (workDays.includes(day.weekday)) seen++;
    }
    return day.plus({ days: 1 });
  }
}
