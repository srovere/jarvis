import type { calendar_v3 } from 'googleapis';
import { vi } from 'vitest';

type Event = calendar_v3.Schema$Event;
interface Stored {
  event: Event;
  rev: number;
}

export interface FakeCalendarOptions {
  /** Calendars of `calendarList.list`; the first one is `primary`. */
  calendars?: string[];
  /** Page size (to exercise pagination). */
  pageSize?: number;
}

const apiError = (code: number): Error & { code: number } => Object.assign(new Error(`HTTP ${code}`), { code });
const instant = (t: calendar_v3.Schema$EventDateTime | undefined): number | undefined => {
  if (t?.dateTime) return Date.parse(t.dateTime);
  if (t?.date) return Date.parse(`${t.date}T00:00:00Z`);
  return undefined;
};

/** In-memory Google Calendar: implements the subset of `calendar_v3.Calendar` the adapter uses. */
export class FakeCalendar {
  readonly calls = { eventsList: vi.fn(), eventsInsert: vi.fn(), calendarListList: vi.fn() };

  private readonly store = new Map<string, Map<string, Stored>>();
  private readonly calendars: string[];
  private readonly pageSize: number;
  private rev = 0;
  private minValidRev = 0;
  private nextId = 1;

  private readonly client = {
    calendarList: { list: async (p: { pageToken?: string }) => this.calendarListList(p) },
    events: {
      list: async (p: EventsListParams) => this.eventsList(p),
      insert: async (p: { calendarId: string; requestBody: Event }) => this.eventsInsert(p),
    },
  };

  constructor(opts: FakeCalendarOptions = {}) {
    this.calendars = opts.calendars ?? ['primary'];
    this.pageSize = opts.pageSize ?? 250;
  }

  asCalendar(): calendar_v3.Calendar {
    return this.client as unknown as calendar_v3.Calendar;
  }

  // --- siembra / mutaciones ---------------------------------------------------------------------

  seed(calendarId: string, event: Event): void {
    this.put(calendarId, event);
  }

  /** Cancels an event: it stays as a `status: 'cancelled'` tombstone. */
  cancel(calendarId: string, id: string): void {
    const cur = this.store.get(calendarId)?.get(id);
    if (cur) this.put(calendarId, { ...cur.event, status: 'cancelled' });
  }

  /** Every `syncToken` issued so far starts answering 410. */
  invalidateSyncTokens(): void {
    this.minValidRev = this.rev + 1;
    this.rev += 1;
  }

  // --- API ----------------------------------------------------------------------------------------

  private calendarListList(p: { pageToken?: string }) {
    this.calls.calendarListList(p);
    const items = this.calendars.map((id, i) => ({ id, summary: id, ...(i === 0 && { primary: true }) }));
    return { data: this.page(items, p.pageToken) };
  }

  private eventsList(p: EventsListParams) {
    this.calls.eventsList(p);
    const all = [...(this.store.get(p.calendarId)?.values() ?? [])];
    let rows: Stored[];
    let sinceRev: number | undefined;
    if (p.syncToken !== undefined) {
      sinceRev = Number(/^sync-(\d+)$/.exec(p.syncToken)?.[1]);
      if (Number.isNaN(sinceRev) || sinceRev < this.minValidRev) {
        throw apiError(410);
      }
      rows = all.filter((s) => s.rev > sinceRev!);
    } else {
      rows = all.filter((s) => this.inWindow(s.event, p));
      if (!p.showDeleted) rows = rows.filter((s) => s.event.status !== 'cancelled');
    }
    rows.sort((a, b) => (instant(a.event.start) ?? 0) - (instant(b.event.start) ?? 0));
    const page = this.page(rows.map((s) => s.event), p.pageToken);
    const last = !page.nextPageToken;
    return { data: { ...page, ...(last && { nextSyncToken: `sync-${this.rev}` }) } };
  }

  private eventsInsert(p: { calendarId: string; requestBody: Event }) {
    this.calls.eventsInsert(p);
    const id = `ev${this.nextId++}`;
    const event: Event = {
      ...p.requestBody,
      id,
      status: 'confirmed',
      htmlLink: `https://calendar.example/event?eid=${id}`,
    };
    this.put(p.calendarId, event);
    return { data: event };
  }

  private inWindow(e: Event, p: EventsListParams): boolean {
    const s = instant(e.start);
    const f = instant(e.end);
    if (s === undefined || f === undefined) return true;
    if (p.timeMin && f <= Date.parse(p.timeMin)) return false;
    if (p.timeMax && s >= Date.parse(p.timeMax)) return false;
    return true;
  }

  private put(calendarId: string, event: Event): void {
    if (!event.id) throw new Error('FakeCalendar: event without id');
    const events = this.store.get(calendarId) ?? new Map<string, Stored>();
    this.store.set(calendarId, events);
    events.set(event.id, { event: { status: 'confirmed', ...event }, rev: ++this.rev });
  }

  private page<T>(items: T[], pageToken: string | undefined): { items: T[]; nextPageToken?: string } {
    const from = pageToken ? Number(pageToken) : 0;
    const to = from + this.pageSize;
    return { items: items.slice(from, to), ...(to < items.length && { nextPageToken: String(to) }) };
  }
}

interface EventsListParams {
  calendarId: string;
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  showDeleted?: boolean;
  singleEvents?: boolean;
  pageToken?: string;
}
