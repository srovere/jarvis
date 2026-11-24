import { DomainError } from '../../domain/errors';
import { TimeRange } from '../../domain/model/time-range';
import type { Clock } from '../../domain/ports/clock';
import type { AccountRepository, EventRepository } from '../../domain/ports/repositories';
import { activeAccounts } from '../active-accounts';
import type { SettingsProvider } from '../config';
import { isAttended, parseIsoIn, toBriefingEvent, type BriefingEvent } from '../views';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;

/**
 * Stored events of the active accounts overlapping [from, to), without cancelled or declined ones. Without `from`
 * the range starts today (configured zone); without `to` it ends 7 days after `from`. At most 31 days.
 */
export class ListEvents {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: EventRepository,
    private readonly settings: SettingsProvider,
    private readonly clock: Clock,
  ) {}

  async execute(q: { from?: string; to?: string }): Promise<BriefingEvent[]> {
    const { zone } = await this.settings.current();
    const to = q.to !== undefined ? parseIsoIn(q.to, zone) : undefined;
    const from =
      q.from !== undefined
        ? parseIsoIn(q.from, zone)
        : to
          ? to.minus({ days: DEFAULT_DAYS })
          : this.clock.now().setZone(zone).startOf('day');
    const end = to ?? from.plus({ days: DEFAULT_DAYS });
    if (end < from) throw new DomainError('"to" must not be before "from"');
    if (end > from.plus({ days: MAX_DAYS })) throw new DomainError(`The range can span at most ${MAX_DAYS} days`);
    if (end.toMillis() === from.toMillis()) return [];
    const range = new TimeRange(from, end);
    const ids = (await activeAccounts(this.accounts)).map((a) => a.id);
    return (await this.events.inRange(ids, range))
      .filter(isAttended)
      .sort((a, b) => a.range.start.toMillis() - b.range.start.toMillis())
      .map((e) => toBriefingEvent(e, zone));
  }
}
