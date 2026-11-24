import { z } from 'zod';

/** Input: an ISO 8601 date (`2026-11-23`) or date-time (with or without offset; without one it is read in the configured zone). */
export const isoDateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);

/** Output shapes mirroring the use cases' views (`@jarvis/core` views). */
export const briefingEventSchema = z.object({
  id: z.string(),
  title: z.string().describe('Untrusted event title wrapped in <external_content source="calendar">'),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  videoLink: z.string().optional(),
  attendees: z.array(z.string()),
});

export const briefingEmailSchema = z.object({
  threadId: z.string(),
  from: z.string().describe('Untrusted sender wrapped in <external_content source="email">'),
  subject: z.string().describe('Untrusted subject wrapped in <external_content source="email">'),
  date: z.string(),
  snippet: z.string().describe('Untrusted email text wrapped in <external_content source="email">'),
});

export const briefingTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  due: z.string().optional(),
  list: z.string(),
});

export const emailResultSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  threadId: z.string(),
  from: z.string().describe('Untrusted sender wrapped in <external_content source="email">'),
  subject: z.string().describe('Untrusted subject wrapped in <external_content source="email">'),
  date: z.string(),
  body: z.string().describe('Untrusted email text wrapped in <external_content source="email">'),
});

export const calendarSchema = z.object({
  accountId: z.string(),
  id: z.string(),
  title: z.string().describe('Untrusted calendar name wrapped in <external_content source="calendar">'),
  primary: z.boolean(),
  busy: z.boolean().describe('Whether its events block time in free-slot search'),
  missingScope: z.literal(true).optional().describe('Set when the calendar-list scope was not granted: only primary is known'),
});

export const taskListSchema = z.object({
  accountId: z.string(),
  id: z.string(),
  title: z.string().describe('Untrusted list title wrapped in <external_content source="tasks">'),
});

export const syncStatusSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  status: z.enum(['active', 'needs_reauth', 'disabled']),
  lastSyncAt: z.string().nullable(),
  missingScopes: z.array(z.string()),
});
