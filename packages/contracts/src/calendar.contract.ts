import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { TimeRange } from '@jarvis/core';
import type { CalendarReader, EventChange, EventWriter } from '@jarvis/core';

export interface CalendarContractSetup {
  reader: CalendarReader;
  writer: EventWriter;
  calendarId: string;
  /** IANA zone used to build the test ranges. */
  zone: string;
}

const upsertIds = (changes: EventChange[]): string[] =>
  changes.flatMap((c) => (c.kind === 'upsert' ? [c.event.id] : []));

export function describeCalendarContract(name: string, setup: () => Promise<CalendarContractSetup>): void {
  describe(`Calendar contract: ${name}`, () => {
    const at = (zone: string, iso: string): DateTime => DateTime.fromISO(iso, { zone });
    const range = (zone: string, startIso: string, endIso: string): TimeRange =>
      new TimeRange(at(zone, startIso), at(zone, endIso));

    it('createEvent + listEvents over the range includes the created event', async () => {
      const { reader, writer, calendarId, zone } = await setup();
      const r = range(zone, '2026-12-01T10:00:00', '2026-12-01T11:00:00');
      const created = await writer.createEvent({ calendarId, title: 'Focus', range: r, transparency: 'opaque' });
      expect(created.id).not.toBe('');
      const events = await reader.listEvents(range(zone, '2026-12-01T00:00:00', '2026-12-02T00:00:00'), [calendarId]);
      const found = events.find((e) => e.id === created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Focus');
      expect(found!.calendarId).toBe(calendarId);
      expect(found!.range.start.toMillis()).toBe(r.start.toMillis());
      expect(found!.range.end.toMillis()).toBe(r.end.toMillis());
    });

    it('listEvents excludes events outside the range', async () => {
      const { reader, writer, calendarId, zone } = await setup();
      const created = await writer.createEvent({
        calendarId,
        title: 'Lejos',
        range: range(zone, '2026-12-10T10:00:00', '2026-12-10T11:00:00'),
        transparency: 'opaque',
      });
      const events = await reader.listEvents(range(zone, '2026-12-01T00:00:00', '2026-12-02T00:00:00'), [calendarId]);
      expect(events.map((e) => e.id)).not.toContain(created.id);
    });

    it('listCalendars includes the calendar once it holds an event', async () => {
      const { reader, writer, calendarId, zone } = await setup();
      await writer.createEvent({
        calendarId,
        title: 'X',
        range: range(zone, '2026-12-03T10:00:00', '2026-12-03T11:00:00'),
        transparency: 'opaque',
      });
      expect((await reader.listCalendars()).map((c) => c.id)).toContain(calendarId);
    });

    it('sync(null) returns a non-empty cursor and sync(nextCursor) without changes is empty', async () => {
      const { reader, writer, calendarId, zone } = await setup();
      const created = await writer.createEvent({
        calendarId,
        title: 'Sync',
        range: range(zone, '2026-12-04T10:00:00', '2026-12-04T11:00:00'),
        transparency: 'opaque',
      });
      const full = await reader.sync(calendarId, null);
      expect(full.nextCursor).not.toBe('');
      expect(full.fullResync).toBe(true);
      expect(upsertIds(full.changes)).toContain(created.id);
      const again = await reader.sync(calendarId, full.nextCursor);
      expect(again.changes).toEqual([]);
      expect(again.fullResync).toBe(false);
    });

    it('sync(cursor) after createEvent contains an upsert for the new event', async () => {
      const { reader, writer, calendarId, zone } = await setup();
      const first = await reader.sync(calendarId, null);
      const created = await writer.createEvent({
        calendarId,
        title: 'Nuevo',
        range: range(zone, '2026-12-05T10:00:00', '2026-12-05T11:00:00'),
        transparency: 'opaque',
      });
      const next = await reader.sync(calendarId, first.nextCursor);
      expect(upsertIds(next.changes)).toContain(created.id);
    });
  });
}
