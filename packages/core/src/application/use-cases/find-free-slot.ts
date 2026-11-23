import type { Clock } from '../../domain/ports/clock';
import type { AccountRepository, EventRepository } from '../../domain/ports/repositories';
import type { FreeSlotFinder } from '../../domain/services/free-slot-finder';
import type { AppSettings } from '../config';
import { FocusSlotSearch } from '../focus-slot-search';
import { isoIn } from '../views';

/** First free work slot within the focus horizon; busy = stored events of each account's busy calendars. */
export class FindFreeSlot {
  private readonly search: FocusSlotSearch;

  constructor(
    accounts: AccountRepository,
    events: EventRepository,
    finder: FreeSlotFinder,
    clock: Clock,
    private readonly settings: AppSettings,
  ) {
    this.search = new FocusSlotSearch(accounts, events, finder, clock, settings);
  }

  async execute(q: { durationMinutes: number; preferredStartHour?: number }): Promise<{ start: string; end: string } | null> {
    const slot = await this.search.find(q);
    return slot && { start: isoIn(slot.start, this.settings.zone), end: isoIn(slot.end, this.settings.zone) };
  }
}
