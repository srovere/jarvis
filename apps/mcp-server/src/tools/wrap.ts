import type { BriefingEvent, EmailResult } from '@jarvis/core';
import { calendarContent, emailContent } from './external-content';

/** Marks every attacker-controlled field of an email (sender, subject, body) as external content. */
export function wrapEmail(m: EmailResult): EmailResult {
  return { ...m, from: emailContent(m.from), subject: emailContent(m.subject), body: emailContent(m.body) };
}

/** Marks an event title (it may come from a third-party invitation) as external content. */
export function wrapEventTitle(e: BriefingEvent): BriefingEvent {
  return { ...e, title: calendarContent(e.title) };
}
