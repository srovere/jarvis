import type { DateTime } from 'luxon';
import type { Account } from '../model/account';
import type { CalendarEvent } from '../model/calendar';
import type { EmailAddress } from '../model/email-address';
import type { MailThreadSummary } from '../model/mail';
import type { Task, TaskList } from '../model/tasks';
import type { TimeRange } from '../model/time-range';
import type { EventChange } from './calendar';
import type { MailChange } from './mail';
import type { TaskChange } from './tasks';

export interface AccountRepository {
  list(): Promise<Account[]>;
  get(id: string): Promise<Account>;
  upsert(a: Account): Promise<void>;
  setStatus(id: string, status: Account['status'], detail?: string): Promise<void>;
}

export interface SyncStateRepository {
  get(accountId: string, resource: string): Promise<string | null>;
  set(accountId: string, resource: string, cursor: string, at: DateTime): Promise<void>;
  lastRunAt(accountId: string, resource: string): Promise<DateTime | null>;
}

export interface MailRepository {
  applyChanges(accountId: string, changes: MailChange[]): Promise<void>;
  recentThreads(accountId: string, q: { since: DateTime; limit: number }): Promise<MailThreadSummary[]>;
  threadsAwaitingReply(accountId: string, own: EmailAddress[], limit: number): Promise<MailThreadSummary[]>;
  /** External ids of the stored messages dated at or after `since`. */
  messageIdsSince(accountId: string, since: DateTime): Promise<string[]>;
}

export interface EventRepository {
  applyChanges(accountId: string, changes: EventChange[]): Promise<void>;
  inRange(accountIds: string[], range: TimeRange): Promise<CalendarEvent[]>;
  /** External ids of the stored events of a calendar that start at or after `from`. */
  eventIdsFrom(accountId: string, calendarId: string, from: DateTime): Promise<string[]>;
}

export interface TaskRepository {
  upsertLists(accountId: string, lists: TaskList[]): Promise<void>;
  applyChanges(accountId: string, listId: string, changes: TaskChange[]): Promise<void>;
  open(q: { accountIds: string[]; dueBefore?: DateTime }): Promise<Task[]>;
  /** Completed, non-deleted tasks. */
  completed(q: { accountIds: string[] }): Promise<Task[]>;
  /** External ids of every stored task of a list (deleted or not). */
  taskIds(accountId: string, listId: string): Promise<string[]>;
  /** The stored task with this external id in any list of the account (deleted or not), or null. */
  get(accountId: string, taskId: string): Promise<Task | null>;
  lists(accountIds: string[]): Promise<TaskList[]>;
}

export interface PersonLinkLookup {
  isLinkedToAnyProject(email: EmailAddress): Promise<boolean>;
}
