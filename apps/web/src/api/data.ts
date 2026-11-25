import { api } from './client';

/*
 * Dashboard data (`/api/today`, `/api/mail`, `/api/calendar`, `/api/tasks`). Every text that comes from an email,
 * event, calendar or task list is untrusted external content: render it through `plainText`, never as HTML.
 * There is deliberately no send-email call: drafts only.
 */

export interface EventItem {
  id: string;
  title: string;
  /** ISO with the configured zone's offset, or a date for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  videoLink?: string;
  attendees: string[];
}

export interface EmailItem {
  threadId: string;
  accountId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface TaskItem {
  id: string;
  accountId: string;
  title: string;
  due?: string;
  /** Title of the task list. */
  list: string;
}

export interface TodayData {
  date: string;
  cards: { meetings: number; freeMinutes: number; priorityEmails: number; tasksDue: number };
  events: EventItem[];
  emails: EmailItem[];
  tasks: TaskItem[];
  /** Open tasks due in the next 7 days, soonest first (at most 5). */
  upcoming: TaskItem[];
}

export interface EmailMessage {
  id: string;
  accountId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  body: string;
}

export interface ThreadView {
  threadId: string;
  subject: string;
  messages: EmailMessage[];
}

export interface MailFilters {
  q?: string;
  from?: string;
  after?: string;
  before?: string;
  accountId?: string;
}

export interface DraftRequest {
  to?: string[];
  subject?: string;
  body: string;
  threadId?: string;
  accountId?: string;
}

export interface DraftResult {
  draftId: string;
  threadId?: string;
  to: string[];
  subject: string;
  gmailUrl: string;
}

export interface TaskList {
  accountId: string;
  id: string;
  title: string;
}

export type TaskStatus = 'open' | 'completed' | 'all';

export interface Slot {
  start: string;
  end: string;
}

export interface FocusResult {
  status: 'created' | 'already_exists' | 'no_slot';
  eventId?: string;
  start?: string;
  end?: string;
  htmlLink?: string;
  searchedWorkDays?: number;
}

export const getToday = () => api<TodayData>('/api/today');

export function searchMail(filters: MailFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  return api<{ emails: EmailMessage[] }>(`/api/mail/search?${params}`);
}
export const getThread = (accountId: string, threadId: string) =>
  api<ThreadView>(`/api/mail/threads/${encodeURIComponent(accountId)}/${encodeURIComponent(threadId)}`);
export const createDraft = (draft: DraftRequest) => api<DraftResult>('/api/mail/drafts', { method: 'POST', body: draft });

export const getEvents = (from: string, to: string) =>
  api<{ events: EventItem[] }>(`/api/calendar/events?from=${from}&to=${to}`);
export const findFreeSlot = (durationMinutes: number) =>
  api<{ slot: Slot | null }>('/api/calendar/free-slot', { method: 'POST', body: { durationMinutes } });
export const blockFocus = (taskName: string, durationMinutes: number, preferredStartHour?: number, accountId?: string) =>
  api<FocusResult>('/api/calendar/focus', {
    method: 'POST',
    body: { taskName, durationMinutes, ...(preferredStartHour !== undefined ? { preferredStartHour } : {}), ...(accountId ? { accountId } : {}) },
  });

export const getTasks = (status: TaskStatus) => api<{ tasks: TaskItem[] }>(`/api/tasks?status=${status}`);
export const getTaskLists = () => api<{ lists: TaskList[] }>('/api/tasks/lists');
export const createTask = (task: { title: string; due?: string; accountId?: string; listId?: string }) =>
  api<TaskItem>('/api/tasks', { method: 'POST', body: task });
export const completeTask = (accountId: string, taskId: string) =>
  api<TaskItem>(`/api/tasks/${encodeURIComponent(accountId)}/${encodeURIComponent(taskId)}/complete`, { method: 'POST' });
