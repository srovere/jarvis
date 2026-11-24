import { DateTime } from 'luxon';
import { DomainError } from '../domain/errors';
import type { CalendarEvent } from '../domain/model/calendar';
import type { MailMessage } from '../domain/model/mail';
import type { Task, TaskList } from '../domain/model/tasks';
import type { EmailCleaner } from '../domain/services/email-cleaner';

export interface BriefingEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  videoLink?: string;
  attendees: string[];
}

export interface BriefingEmail {
  threadId: string;
  from: string;
  subject: string;
  date: string;
  /** Clean snippet. */
  snippet: string;
}

export interface BriefingTask {
  id: string;
  title: string;
  due?: string;
  list: string;
}

export interface EmailResult {
  id: string;
  accountId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  /** Body cleaned by `EmailCleaner.clean`. */
  body: string;
}

export interface DailyBriefing {
  /** ISO date in the configured zone. */
  date: string;
  events: BriefingEvent[];
  priorityEmails: BriefingEmail[];
  tasksDue: BriefingTask[];
  /** Free minutes within the day's work hours (from now if the day is in progress; 0 on a non-work day). */
  freeMinutes: number;
  accountsNeedingReauth: string[];
}

/** ISO timestamp of `dt` in `zone`. */
export function isoIn(dt: DateTime, zone: string): string {
  const iso = dt.setZone(zone).toISO();
  if (iso === null) throw new DomainError(`Invalid date or zone: ${zone}`);
  return iso;
}

/** Parses an ISO string; one without offset is read in `zone`. */
export function parseIsoIn(value: string, zone: string): DateTime {
  const dt = DateTime.fromISO(value, { zone, setZone: true });
  if (!dt.isValid) throw new DomainError(`Invalid date: ${value}`);
  return dt;
}

/** Events the user will attend: neither cancelled nor declined. */
export function isAttended(e: CalendarEvent): boolean {
  return e.status !== 'cancelled' && e.myResponse !== 'declined';
}

export function toBriefingEvent(e: CalendarEvent, zone: string): BriefingEvent {
  return {
    id: e.id,
    title: e.title,
    start: isoIn(e.range.start, zone),
    end: isoIn(e.range.end, zone),
    allDay: e.allDay,
    ...(e.videoLink ? { videoLink: e.videoLink } : {}),
    attendees: e.attendees.map((a) => a.email.address),
  };
}

/** Maps tasks to views, resolving each list title from `lists` (falls back to the list id). */
export function toBriefingTasks(tasks: Task[], lists: TaskList[], zone: string): BriefingTask[] {
  const titles = new Map(lists.map((l) => [`${l.accountId}|${l.id}`, l.title]));
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    ...(t.due ? { due: isoIn(t.due, zone) } : {}),
    list: titles.get(`${t.accountId}|${t.listId}`) ?? t.listId,
  }));
}

export function toEmailResult(m: MailMessage, cleaner: EmailCleaner, zone: string): EmailResult {
  return {
    id: m.id,
    accountId: m.accountId,
    threadId: m.threadId,
    from: m.from.toString(),
    subject: m.subject,
    date: isoIn(m.date, zone),
    body: cleaner.clean(m),
  };
}
