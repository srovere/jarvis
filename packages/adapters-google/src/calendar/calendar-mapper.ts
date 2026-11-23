import { EmailAddress, TimeRange } from '@jarvis/core';
import type { CalendarEvent, EventResponse } from '@jarvis/core';
import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';

const RESPONSES: EventResponse[] = ['accepted', 'declined', 'tentative', 'needsAction'];
const toResponse = (r: string | null | undefined): EventResponse =>
  RESPONSES.find((x) => x === r) ?? 'needsAction';

export class CalendarMapper {
  constructor(
    private readonly accountId: string,
    private readonly zone: string,
  ) {}

  toEvent(e: calendar_v3.Schema$Event, calendarId: string): CalendarEvent | null {
    const range = this.toRange(e);
    if (!e.id || !range) return null;
    const attendees = (e.attendees ?? []).flatMap((a) => {
      const email = this.tryParse(a.email);
      return email ? [{ email, response: toResponse(a.responseStatus), self: a.self === true }] : [];
    });
    const selfAttendee = (e.attendees ?? []).find((a) => a.self === true);
    const event: CalendarEvent = {
      id: e.id,
      accountId: this.accountId,
      calendarId,
      title: e.summary ?? '',
      range: range.range,
      allDay: range.allDay,
      attendees,
      status: this.toStatus(e.status),
      raw: e,
    };
    if (selfAttendee) event.myResponse = toResponse(selfAttendee.responseStatus);
    const video = this.videoLink(e);
    if (video) event.videoLink = video;
    if (e.htmlLink) event.htmlLink = e.htmlLink;
    return event;
  }

  private toRange(e: calendar_v3.Schema$Event): { range: TimeRange; allDay: boolean } | null {
    const { start, end } = e;
    if (start?.date) {
      const s = DateTime.fromISO(start.date, { zone: this.zone }).startOf('day');
      const f = end?.date ? DateTime.fromISO(end.date, { zone: this.zone }).startOf('day') : s.plus({ days: 1 });
      return s.isValid && f.isValid ? { range: this.safeRange(s, f), allDay: true } : null;
    }
    if (start?.dateTime && end?.dateTime) {
      const s = DateTime.fromISO(start.dateTime, { zone: this.zone });
      const f = DateTime.fromISO(end.dateTime, { zone: this.zone });
      return s.isValid && f.isValid ? { range: this.safeRange(s, f), allDay: false } : null;
    }
    return null;
  }

  /** Eventos de duración cero o negativa se ensanchan a 1 minuto: siguen visibles y no abortan la lectura. */
  private safeRange(s: DateTime, f: DateTime): TimeRange {
    return new TimeRange(s, f > s ? f : s.plus({ minutes: 1 }));
  }

  private toStatus(status: string | null | undefined): CalendarEvent['status'] {
    return status === 'tentative' || status === 'cancelled' ? status : 'confirmed';
  }

  private videoLink(e: calendar_v3.Schema$Event): string | undefined {
    if (e.hangoutLink) return e.hangoutLink;
    return e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri)?.uri ?? undefined;
  }

  private tryParse(raw: string | null | undefined): EmailAddress | undefined {
    if (!raw) return undefined;
    try {
      return EmailAddress.parse(raw);
    } catch {
      return undefined;
    }
  }
}
