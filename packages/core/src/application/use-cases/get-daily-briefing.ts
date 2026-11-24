import { DateTime } from 'luxon';
import { TimeRange } from '../../domain/model/time-range';
import type { Account } from '../../domain/model/account';
import type { EmailAddress } from '../../domain/model/email-address';
import type { MailThreadSummary } from '../../domain/model/mail';
import type { Clock } from '../../domain/ports/clock';
import type { AccountRepository, EventRepository, MailRepository, TaskRepository } from '../../domain/ports/repositories';
import type { EmailCleaner } from '../../domain/services/email-cleaner';
import type { PriorityRules } from '../../domain/services/priority-rules';
import { busyCalendarsOf, type AppSettings, type SettingsProvider } from '../config';
import type { ProviderRegistry } from '../provider-registry';
import { isAttended, isoIn, toBriefingEvent, toBriefingTasks, type BriefingEmail, type DailyBriefing } from '../views';

/** How far back before the day the priority-email candidates go. */
const EMAIL_LOOKBACK_DAYS = 7;
const EMAIL_CANDIDATES_PER_ACCOUNT = 100;

/** Builds the briefing of one day (today + `dateOffsetDays` in the configured zone) from the synced data. */
export class GetDailyBriefing {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
    private readonly mail: MailRepository,
    private readonly events: EventRepository,
    private readonly tasks: TaskRepository,
    private readonly priority: PriorityRules,
    private readonly cleaner: EmailCleaner,
    private readonly clock: Clock,
    private readonly settings: SettingsProvider,
  ) {}

  async execute(q: { dateOffsetDays: number }): Promise<DailyBriefing> {
    const settings = await this.settings.current();
    const zone = settings.zone;
    const day = this.clock.now().setZone(zone).plus({ days: q.dateOffsetDays }).startOf('day');
    const range = new TimeRange(day, day.plus({ days: 1 }));
    const all = await this.accounts.list();
    const active = all.filter((a) => a.status === 'active');
    const ids = active.map((a) => a.id);

    const events = (await this.events.inRange(ids, range))
      .filter(isAttended)
      .sort((a, b) => a.range.start.toMillis() - b.range.start.toMillis())
      .map((e) => toBriefingEvent(e, zone));

    const [due, lists] = await Promise.all([this.tasks.open({ accountIds: ids, dueBefore: range.end }), this.tasks.lists(ids)]);

    return {
      date: day.toISODate()!,
      events,
      priorityEmails: await this.priorityEmails(active, range, settings),
      tasksDue: toBriefingTasks(due, lists, zone),
      freeMinutes: await this.freeMinutes(day, ids, settings),
      accountsNeedingReauth: all.filter((a) => a.status === 'needs_reauth').map((a) => a.id),
    };
  }

  /**
   * Minutes of `day`'s work hours not covered by a busy event (busy calendars of the active accounts, the same
   * events free-slot search avoids). Counted from now when the day is in progress; 0 on a non-work day or once over.
   */
  private async freeMinutes(day: DateTime, accountIds: string[], settings: AppSettings): Promise<number> {
    const { zone, startHour, endHour, workDays } = settings.workSchedule;
    if (!workDays.includes(day.setZone(zone).weekday)) return 0;
    const local = day.setZone(zone);
    const start = DateTime.max(local.set({ hour: startHour }), this.clock.now());
    const end = local.set({ hour: endHour });
    if (end <= start) return 0;
    const window = new TimeRange(start, end);
    const busy = (await this.events.inRange(accountIds, window))
      .filter((e) => busyCalendarsOf(settings, e.accountId).includes(e.calendarId))
      .filter((e) => e.blocksTime && e.status !== 'cancelled' && e.myResponse !== 'declined')
      .map((e) => [Math.max(e.range.start.toMillis(), start.toMillis()), Math.min(e.range.end.toMillis(), end.toMillis())] as const)
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let busyMs = 0;
    let cursor = start.toMillis();
    for (const [s, e] of busy) {
      const from = Math.max(s, cursor);
      if (e > from) busyMs += e - from;
      cursor = Math.max(cursor, e);
    }
    return Math.round((window.durationMinutes() * 60_000 - busyMs) / 60_000);
  }

  /** Live own addresses; on any provider failure falls back to the account address (read-only: no status change). */
  private async ownAddresses(account: Account): Promise<EmailAddress[]> {
    try {
      return await (await this.registry.forAccount(account)).identity.ownAddresses();
    } catch {
      return [account.email];
    }
  }

  private async priorityEmails(active: Account[], day: TimeRange, settings: AppSettings): Promise<BriefingEmail[]> {
    const since = day.start.minus({ days: EMAIL_LOOKBACK_DAYS });
    const candidates: MailThreadSummary[] = [];
    const own: EmailAddress[] = [];
    for (const account of active) {
      own.push(...(await this.ownAddresses(account)));
      candidates.push(...(await this.mail.recentThreads(account.id, { since, limit: EMAIL_CANDIDATES_PER_ACCOUNT })));
    }
    const ranked = await this.priority.rank(candidates, own, settings.briefing.maxPriorityEmails);
    return ranked.map((t) => ({
      threadId: t.id,
      from: t.lastFrom.toString(),
      subject: t.subject,
      date: isoIn(t.lastMessageAt, settings.zone),
      snippet: this.cleaner.cleanSnippet(t.snippet),
    }));
  }
}
