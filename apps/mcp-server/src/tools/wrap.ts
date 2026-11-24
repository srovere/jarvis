import type { BriefingEvent, CalendarView, EmailResult, TaskListView } from '@jarvis/core';
import { calendarContent, emailContent, tasksContent } from './external-content';

/** Marks every attacker-controlled field of an email (sender, subject, body) as external content. */
export function wrapEmail(m: EmailResult): EmailResult {
  return { ...m, from: emailContent(m.from), subject: emailContent(m.subject), body: emailContent(m.body) };
}

/** Marks an event title (it may come from a third-party invitation) as external content. */
export function wrapEventTitle(e: BriefingEvent): BriefingEvent {
  return { ...e, title: calendarContent(e.title) };
}

/** Marks a calendar name (shared calendars carry names set by others) as external content. */
export function wrapCalendar(c: CalendarView): CalendarView {
  return { ...c, title: calendarContent(c.title) };
}

/** Marks a task list title as external content. */
export function wrapTaskList(l: TaskListView): TaskListView {
  return { ...l, title: tasksContent(l.title) };
}
