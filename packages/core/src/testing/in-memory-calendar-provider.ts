import { CursorExpired } from '../domain/errors';
import type { CalendarEvent } from '../domain/model/calendar';
import type { TimeRange } from '../domain/model/time-range';
import type { CalendarReader, EventChange, EventWriter, NewEvent } from '../domain/ports/calendar';
import type { SyncResult } from '../domain/ports/mail';
import { ChangeLog } from './change-log';

type CalendarInfo = { id: string; title: string; primary: boolean };

export class InMemoryCalendarProvider implements CalendarReader, EventWriter {
  private readonly calendars: CalendarInfo[] = [];
  private readonly events = new Map<string, CalendarEvent>();
  private readonly log = new ChangeLog<string, EventChange>();
  private readonly accountId: string;
  private nextId = 1;

  constructor(opts: { accountId: string }) {
    this.accountId = opts.accountId;
  }

  seedCalendars(calendars: CalendarInfo[]): void {
    this.calendars.push(...calendars);
  }

  seed(events: CalendarEvent[]): void {
    for (const event of events) this.store(event);
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const known = new Set(this.calendars.map((c) => c.id));
    const implied = [...new Set([...this.events.values()].map((e) => e.calendarId))]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, title: id, primary: false }));
    return [...this.calendars, ...implied];
  }

  async listEvents(range: TimeRange, calendarIds: string[]): Promise<CalendarEvent[]> {
    return [...this.events.values()]
      .filter((e) => calendarIds.includes(e.calendarId) && e.range.overlaps(range))
      .sort((a, b) => a.range.start.toMillis() - b.range.start.toMillis());
  }

  async sync(calendarId: string, cursor: string | null): Promise<SyncResult<EventChange>> {
    const nextCursor = this.log.currentCursor;
    if (cursor === null) {
      const changes = [...this.events.values()]
        .filter((e) => e.calendarId === calendarId)
        .map((event): EventChange => ({ kind: 'upsert', event }));
      return { changes, nextCursor, fullResync: true };
    }
    if (!/^\d+$/.test(cursor)) throw new CursorExpired(`Invalid cursor: ${cursor}`);
    return { changes: this.log.since(cursor, (k) => k === calendarId), nextCursor, fullResync: false };
  }

  async createEvent(e: NewEvent): Promise<{ id: string; htmlLink?: string }> {
    const id = `event-${this.nextId++}`;
    const htmlLink = `https://calendar.test/${id}`;
    const event: CalendarEvent = {
      id,
      accountId: this.accountId,
      calendarId: e.calendarId,
      title: e.title,
      range: e.range,
      allDay: false,
      attendees: [],
      htmlLink,
      status: 'confirmed',
    };
    this.store(event);
    return { id, htmlLink };
  }

  private store(event: CalendarEvent): void {
    this.events.set(`${event.calendarId}:${event.id}`, event);
    this.log.record(event.calendarId, { kind: 'upsert', event });
  }
}
