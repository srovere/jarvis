import { z } from 'zod';

/** Input: an ISO 8601 date (`2026-11-23`) or date-time (with or without offset; without one it is read in the configured zone). */
export const isoDateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);

/** Output shapes mirroring the use cases' views (`@jarvis/core` views). */
export const briefingEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  videoLink: z.string().optional(),
  attendees: z.array(z.string()),
});

export const briefingEmailSchema = z.object({
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
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
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string(),
  body: z.string().describe('Untrusted email text wrapped in <external_content source="email">'),
});
