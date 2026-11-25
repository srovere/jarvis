import { DomainError } from '@jarvis/core';
import type { CalendarEvent, CalendarReader, EventChange, EventWriter, NewEvent, SyncResult, TimeRange } from '@jarvis/core';
import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';
import { callGoogle, isGone } from '../google-errors';
import { CalendarMapper } from './calendar-mapper';

/**
 * Full-resync window. Must match `CALENDAR_RESYNC_DAYS` in `SyncAccount` (core): that reconciliation
 * deletes stored events from that point on that are missing from the snapshot.
 */
const INITIAL_WINDOW_DAYS = 30;
const PAGE_SIZE = 250;

/** Google's alias for the user's primary calendar. */
const PRIMARY = 'primary';

/** Google Calendar as `CalendarReader` and `EventWriter`. */
export class GoogleCalendarAdapter implements CalendarReader, EventWriter {
  private readonly mapper: CalendarMapper;

  constructor(
    private readonly cal: calendar_v3.Calendar,
    private readonly accountId: string,
    private readonly zone: string,
    private readonly now: () => DateTime = () => DateTime.now(),
  ) {
    this.mapper = new CalendarMapper(accountId, zone);
  }

  async listCalendars(): Promise<{ id: string; title: string; primary: boolean }[]> {
    const out: { id: string; title: string; primary: boolean }[] = [];
    let pageToken: string | undefined;
    do {
      const token = pageToken;
      const page = await this.call(() => this.cal.calendarList.list({ maxResults: PAGE_SIZE, pageToken: token }));
      for (const c of page.items ?? []) {
        if (!c.id) continue;
        // The primary calendar is always reported as 'primary' (the alias Jarvis stores and syncs by default):
        // under its real id (the account's email) it would be stored and synced a second time.
        const primary = c.primary === true;
        out.push({ id: primary ? PRIMARY : c.id, title: c.summaryOverride ?? c.summary ?? c.id, primary });
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async listEvents(range: TimeRange, calendarIds: string[]): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    for (const calendarId of calendarIds) {
      let pageToken: string | undefined;
      do {
        const token = pageToken;
        const page = await this.call(() =>
          this.cal.events.list({
            calendarId,
            singleEvents: true,
            orderBy: 'startTime',
            timeMin: range.start.toUTC().toISO()!,
            timeMax: range.end.toUTC().toISO()!,
            maxResults: PAGE_SIZE,
            pageToken: token,
          }),
        );
        for (const e of page.items ?? []) {
          const mapped = this.mapper.toEvent(e, calendarId);
          if (mapped && mapped.status !== 'cancelled') out.push(mapped);
        }
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);
    }
    return out;
  }

  async sync(calendarId: string, cursor: string | null): Promise<SyncResult<EventChange>> {
    if (cursor === null) return this.fullSync(calendarId);
    try {
      return await this.collect(calendarId, { syncToken: cursor }, false);
    } catch (e) {
      if (isGone(e)) return this.fullSync(calendarId);
      throw e;
    }
  }

  async createEvent(e: NewEvent): Promise<{ id: string; htmlLink?: string }> {
    const iso = (t: DateTime): string => t.setZone(this.zone).toISO()!;
    const created = await this.call(() =>
      this.cal.events.insert({
        calendarId: e.calendarId,
        requestBody: {
          summary: e.title,
          ...(e.description !== undefined && { description: e.description }),
          start: { dateTime: iso(e.range.start), timeZone: this.zone },
          end: { dateTime: iso(e.range.end), timeZone: this.zone },
          transparency: e.transparency,
        },
      }),
    );
    if (!created.id) throw new DomainError('Calendar returned an event without id');
    return { id: created.id, ...(created.htmlLink && { htmlLink: created.htmlLink }) };
  }

  private fullSync(calendarId: string): Promise<SyncResult<EventChange>> {
    const timeMin = this.now().minus({ days: INITIAL_WINDOW_DAYS }).toUTC().toISO()!;
    return this.collect(calendarId, { timeMin }, true);
  }

  /** Walks every page; `nextSyncToken` only arrives on the last one. */
  private async collect(
    calendarId: string,
    params: { syncToken?: string; timeMin?: string },
    fullResync: boolean,
  ): Promise<SyncResult<EventChange>> {
    const changes: EventChange[] = [];
    let pageToken: string | undefined;
    let nextCursor: string | undefined;
    do {
      const token = pageToken;
      const page = await this.call(() =>
        this.cal.events.list({ calendarId, singleEvents: true, showDeleted: true, maxResults: PAGE_SIZE, pageToken: token, ...params }),
      );
      for (const e of page.items ?? []) {
        if (e.status === 'cancelled') {
          if (e.id) changes.push({ kind: 'delete', eventId: e.id, calendarId });
          continue;
        }
        const event = this.mapper.toEvent(e, calendarId);
        if (event) changes.push({ kind: 'upsert', event });
      }
      pageToken = page.nextPageToken ?? undefined;
      nextCursor = page.nextSyncToken ?? undefined;
    } while (pageToken);
    if (!nextCursor) throw new DomainError('Calendar sync returned no nextSyncToken');
    return { changes, nextCursor, fullResync };
  }

  private call<T>(request: () => Promise<{ data: T }>): Promise<T> {
    return callGoogle(this.accountId, request);
  }
}
