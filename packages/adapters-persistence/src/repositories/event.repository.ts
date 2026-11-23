import { TimeRange, type CalendarEvent, type EventChange, type EventRepository } from '@jarvis/core';
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { fromDate, fromStoredAddress, toDate, toStoredAddress } from '../mappers';
import { calendars, events } from '../schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzleEventRepository implements EventRepository {
  constructor(private readonly db: Db) {}

  async applyChanges(accountId: string, changes: EventChange[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const c of changes) {
        if (c.kind === 'upsert') await this.upsert(tx, accountId, c.event);
        else await this.remove(tx, accountId, c.calendarId, c.eventId);
      }
    });
  }

  async inRange(accountIds: string[], range: TimeRange): Promise<CalendarEvent[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .select({ event: events, calendarExternalId: calendars.externalId })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(
        and(
          inArray(events.accountId, accountIds),
          lt(events.startsAt, toDate(range.end)),
          gt(events.endsAt, toDate(range.start)),
        ),
      )
      .orderBy(asc(events.startsAt));
    return rows.map((r) => toEvent(r.event, r.calendarExternalId));
  }

  private async upsert(tx: Tx, accountId: string, e: CalendarEvent): Promise<void> {
    const calendarId = await this.ensureCalendar(tx, accountId, e.calendarId);
    const values = {
      calendarId,
      title: e.title,
      startsAt: toDate(e.range.start),
      endsAt: toDate(e.range.end),
      allDay: e.allDay,
      status: e.status,
      myResponse: e.myResponse ?? null,
      attendees: e.attendees.map((a) => ({ email: toStoredAddress(a.email), response: a.response, self: a.self })),
      videoLink: e.videoLink ?? null,
      htmlLink: e.htmlLink ?? null,
      raw: e.raw ?? null,
    };
    await tx
      .insert(events)
      .values({ accountId, externalId: e.id, ...values })
      .onConflictDoUpdate({
        target: [events.accountId, events.externalId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }

  private async remove(tx: Tx, accountId: string, calendarExternalId: string, eventId: string): Promise<void> {
    const calendar = tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.accountId, accountId), eq(calendars.externalId, calendarExternalId)));
    await tx
      .delete(events)
      .where(and(eq(events.accountId, accountId), eq(events.externalId, eventId), inArray(events.calendarId, calendar)));
  }

  /** Calendars are only known by their external id here; a placeholder row is created until richer data arrives. */
  private async ensureCalendar(tx: Tx, accountId: string, externalId: string): Promise<string> {
    await tx
      .insert(calendars)
      .values({ accountId, externalId, title: externalId })
      .onConflictDoNothing({ target: [calendars.accountId, calendars.externalId] });
    const [row] = await tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.accountId, accountId), eq(calendars.externalId, externalId)));
    return row!.id;
  }
}

function toEvent(row: typeof events.$inferSelect, calendarExternalId: string): CalendarEvent {
  return {
    id: row.externalId,
    accountId: row.accountId,
    calendarId: calendarExternalId,
    title: row.title,
    range: new TimeRange(fromDate(row.startsAt), fromDate(row.endsAt)),
    allDay: row.allDay,
    attendees: row.attendees.map((a) => ({ email: fromStoredAddress(a.email), response: a.response, self: a.self })),
    ...(row.myResponse ? { myResponse: row.myResponse } : {}),
    ...(row.videoLink ? { videoLink: row.videoLink } : {}),
    ...(row.htmlLink ? { htmlLink: row.htmlLink } : {}),
    status: row.status,
    ...(row.raw != null ? { raw: row.raw } : {}),
  };
}
