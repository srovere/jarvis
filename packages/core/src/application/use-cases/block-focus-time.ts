import { DomainError } from '../../domain/errors';
import type { CalendarEvent } from '../../domain/model/calendar';
import type { AccountRepository, EventRepository } from '../../domain/ports/repositories';
import { selectAccount } from '../active-accounts';
import { busyCalendarsOf, type AppSettings } from '../config';
import { FocusSlotSearch } from '../focus-slot-search';
import type { ProviderRegistry } from '../provider-registry';
import { isAttended, isoIn } from '../views';

export type BlockFocusResult =
  | { status: 'created'; eventId: string; start: string; end: string; htmlLink?: string }
  | { status: 'already_exists'; eventId: string; start: string; end: string }
  | { status: 'no_slot'; searchedWorkDays: number };

/** Creates a focus block in the first free slot, unless that day already has one for the same task. */
export class BlockFocusTime {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: EventRepository,
    private readonly slots: FocusSlotSearch,
    private readonly registry: ProviderRegistry,
    private readonly settings: AppSettings,
  ) {}

  async execute(q: { taskName: string; durationMinutes?: number; preferredStartHour?: number; accountId?: string }): Promise<BlockFocusResult> {
    const account = await selectAccount(this.accounts, q.accountId);
    const { zone, focus } = this.settings;
    const title = `${focus.titlePrefix}${q.taskName}`;
    const calendars = [...new Set([...busyCalendarsOf(this.settings, account.id), 'primary'])];
    const horizon = this.slots.horizon();
    const now = horizon.start;
    const upcoming = await this.events.inRange([account.id], horizon);
    const existing = upcoming
      .filter((e) => e.title === title && calendars.includes(e.calendarId) && isAttended(e) && e.range.end > now)
      .sort((a, b) => a.range.start.toMillis() - b.range.start.toMillis())[0];
    if (existing) {
      return { status: 'already_exists', eventId: existing.id, start: isoIn(existing.range.start, zone), end: isoIn(existing.range.end, zone) };
    }

    const slot = await this.slots.find({
      durationMinutes: q.durationMinutes ?? focus.defaultDurationMinutes,
      ...(q.preferredStartHour !== undefined ? { preferredStartHour: q.preferredStartHour } : {}),
    });
    if (!slot) return { status: 'no_slot', searchedWorkDays: focus.horizonWorkDays };

    const calendar = (await this.registry.forAccount(account)).calendar;
    if (!calendar) throw new DomainError(`Account ${account.id} does not support calendar`);
    const created = await calendar.createEvent({
      calendarId: 'primary',
      title,
      range: slot,
      description: 'Focus block created by Jarvis',
      transparency: 'opaque',
    });
    const stored: CalendarEvent = {
      id: created.id,
      accountId: account.id,
      calendarId: 'primary',
      title,
      range: slot,
      allDay: false,
      attendees: [],
      myResponse: 'accepted',
      status: 'confirmed',
      ...(created.htmlLink ? { htmlLink: created.htmlLink } : {}),
    };
    await this.events.applyChanges(account.id, [{ kind: 'upsert', event: stored }]);
    return {
      status: 'created',
      eventId: created.id,
      start: isoIn(slot.start, zone),
      end: isoIn(slot.end, zone),
      ...(created.htmlLink ? { htmlLink: created.htmlLink } : {}),
    };
  }
}
