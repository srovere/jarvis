import { TimeRange } from '../../domain/model/time-range';
import type { AccountRepository, EventRepository } from '../../domain/ports/repositories';
import { activeAccounts } from '../active-accounts';
import type { AppSettings } from '../config';
import { isAttended, parseIsoIn, toBriefingEvent, type BriefingEvent } from '../views';

/** Stored events of the active accounts overlapping [from, to), without cancelled or declined ones. */
export class ListEvents {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: EventRepository,
    private readonly settings: AppSettings,
  ) {}

  async execute(q: { from: string; to: string }): Promise<BriefingEvent[]> {
    const zone = this.settings.zone;
    const range = new TimeRange(parseIsoIn(q.from, zone), parseIsoIn(q.to, zone));
    const ids = (await activeAccounts(this.accounts)).map((a) => a.id);
    return (await this.events.inRange(ids, range))
      .filter(isAttended)
      .sort((a, b) => a.range.start.toMillis() - b.range.start.toMillis())
      .map((e) => toBriefingEvent(e, zone));
  }
}
