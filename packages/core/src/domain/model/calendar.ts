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
  /** False for events that do not occupy the user's time: marked "free" (transparent) or working-location. */
  blocksTime: boolean;
  attendees: { email: EmailAddress; response: EventResponse; self: boolean }[];
  myResponse?: EventResponse;
  videoLink?: string;
  htmlLink?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  raw?: unknown;
}
