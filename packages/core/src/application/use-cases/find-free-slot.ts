import type { DateTime } from 'luxon';
import { TimeRange } from '../../domain/model/time-range';
import type { Clock } from '../../domain/ports/clock';
import type { AccountRepository, EventRepository } from '../../domain/ports/repositories';
import type { FreeSlotFinder } from '../../domain/services/free-slot-finder';
import { activeAccounts } from '../active-accounts';
import { busyCalendarsOf, type AppSettings } from '../config';
import { isoIn } from '../views';

/** Same bound as `FreeSlotFinder` on the calendar days it scans. */
const MAX_SCAN_DAYS = 400;

/** First free work slot within the focus horizon; busy = stored events of each account's busy calendars. */
export class FindFreeSlot {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: EventRepository,
    private readonly finder: FreeSlotFinder,
    private readonly clock: Clock,
    private readonly settings: AppSettings,
  ) {}

  async execute(q: { durationMinutes: number; preferredStartHour?: number }): Promise<{ start: string; end: string } | null> {
    const now = this.clock.now();
    const horizonWorkDays = this.settings.focus.horizonWorkDays;
    const active = await activeAccounts(this.accounts);
    const stored = await this.events.inRange(
      active.map((a) => a.id),
      new TimeRange(now, this.horizonEnd(now, horizonWorkDays)),
    );
    const busy = stored.filter((e) => busyCalendarsOf(this.settings, e.accountId).includes(e.calendarId));
    const slot = this.finder.find({
      now,
      durationMinutes: q.durationMinutes,
      busy,
      ...(q.preferredStartHour !== undefined ? { preferredStartHour: q.preferredStartHour } : {}),
      horizonWorkDays,
    });
    return slot && { start: isoIn(slot.start, this.settings.zone), end: isoIn(slot.end, this.settings.zone) };
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
