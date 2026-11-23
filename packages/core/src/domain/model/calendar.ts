import type { EmailAddress } from './email-address';
import type { TimeRange } from './time-range';

export type EventResponse = 'accepted' | 'declined' | 'tentative' | 'needsAction';

export interface CalendarEvent {
  id: string;
  accountId: string;
  calendarId: string;
  title: string;
  range: TimeRange;
  allDay: boolean;
  attendees: { email: EmailAddress; response: EventResponse; self: boolean }[];
  myResponse?: EventResponse;
  videoLink?: string;
  htmlLink?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  raw?: unknown;
}
