import type { CalendarEvent } from '../model/calendar';
import type { TimeRange } from '../model/time-range';
import type { SyncResult } from './mail';

export type EventChange =
  | { kind: 'upsert'; event: CalendarEvent }
  | { kind: 'delete'; eventId: string; calendarId: string };

export interface CalendarReader {
  listCalendars(): Promise<{ id: string; title: string; primary: boolean }[]>;
  listEvents(range: TimeRange, calendarIds: string[]): Promise<CalendarEvent[]>;
  sync(calendarId: string, cursor: string | null): Promise<SyncResult<EventChange>>;
}

export interface NewEvent {
  calendarId: string;
  title: string;
  range: TimeRange;
  description?: string;
  transparency: 'opaque';
}

export interface EventWriter {
  createEvent(e: NewEvent): Promise<{ id: string; htmlLink?: string }>;
}
