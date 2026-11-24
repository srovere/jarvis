import type { Clock } from '../../domain/ports/clock';
import type { AccountRepository, EventRepository } from '../../domain/ports/repositories';
import type { SettingsProvider } from '../config';
import { FocusSlotSearch } from '../focus-slot-search';
import { isoIn } from '../views';

/** First free work slot within the focus horizon; busy = stored events of each account's busy calendars. */
export class FindFreeSlot {
  private readonly search: FocusSlotSearch;

  constructor(
    accounts: AccountRepository,
    events: EventRepository,
    clock: Clock,
    private readonly settings: SettingsProvider,
  ) {
    this.search = new FocusSlotSearch(accounts, events, clock);
  }

  async execute(q: { durationMinutes: number; preferredStartHour?: number }): Promise<{ start: string; end: string } | null> {
    const settings = await this.settings.current();
    const slot = await this.search.find(settings, q);
    return slot && { start: isoIn(slot.start, settings.zone), end: isoIn(slot.end, settings.zone) };
  }
}
