import { TimeRange } from '../../domain/model/time-range';
import type { Account } from '../../domain/model/account';
import type { EmailAddress } from '../../domain/model/email-address';
import type { MailThreadSummary } from '../../domain/model/mail';
import type { Clock } from '../../domain/ports/clock';
import type { AccountRepository, EventRepository, MailRepository, TaskRepository } from '../../domain/ports/repositories';
import type { EmailCleaner } from '../../domain/services/email-cleaner';
import type { PriorityRules } from '../../domain/services/priority-rules';
import type { AppSettings, SettingsProvider } from '../config';
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
      accountsNeedingReauth: all.filter((a) => a.status === 'needs_reauth').map((a) => a.id),
    };
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
