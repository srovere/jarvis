import type { DateTime } from 'luxon';
import { DomainError } from '../domain/errors';
import type { Account } from '../domain/model/account';
import type { CalendarEvent } from '../domain/model/calendar';
import type { EmailAddress } from '../domain/model/email-address';
import type { MailMessage, MailThreadSummary } from '../domain/model/mail';
import type { Task, TaskList } from '../domain/model/tasks';
import type { TimeRange } from '../domain/model/time-range';
import type { EventChange } from '../domain/ports/calendar';
import type { MailChange } from '../domain/ports/mail';
import type {
  AccountRepository,
  EventRepository,
  MailRepository,
  PersonLinkLookup,
  SyncStateRepository,
  TaskRepository,
} from '../domain/ports/repositories';
import type { PendingSyncRequest, SyncRequests } from '../domain/ports/sync-requests';
import type { TaskChange } from '../domain/ports/tasks';

/** Repositories that hold per-account synced data. */
interface AccountDataStore {
  deleteAccountData(accountId: string): void;
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly accounts = new Map<string, Account>();
  readonly statusDetails = new Map<string, string | undefined>();

  constructor(private readonly dataStores: AccountDataStore[] = []) {}

  async list(): Promise<Account[]> {
    return [...this.accounts.values()];
  }

  async get(id: string): Promise<Account> {
    const a = this.accounts.get(id);
    if (!a) throw new DomainError(`Account not found: ${id}`);
    return a;
  }

  async upsert(a: Account): Promise<void> {
    this.accounts.set(a.id, a);
  }

  async setStatus(id: string, status: Account['status'], detail?: string): Promise<void> {
    const a = await this.get(id);
    const { statusDetail: _old, ...rest } = a;
    this.accounts.set(id, { ...rest, status, ...(detail !== undefined ? { statusDetail: detail } : {}) });
    this.statusDetails.set(id, detail);
  }

  async findByEmail(email: EmailAddress): Promise<Account | null> {
    return [...this.accounts.values()].find((a) => a.email.equals(email)) ?? null;
  }

  async setBusyCalendars(id: string, ids: string[]): Promise<void> {
    this.accounts.set(id, { ...(await this.get(id)), busyCalendars: ids });
  }

  async setMissingScopes(id: string, scopes: string[]): Promise<void> {
    this.accounts.set(id, { ...(await this.get(id)), missingScopes: scopes });
  }

  async deleteData(id: string): Promise<void> {
    for (const store of this.dataStores) store.deleteAccountData(id);
  }
}

export class InMemorySyncStateRepository implements SyncStateRepository {
  private readonly state = new Map<string, { cursor: string; at: DateTime }>();

  async get(accountId: string, resource: string): Promise<string | null> {
    return this.state.get(`${accountId}|${resource}`)?.cursor ?? null;
  }

  async set(accountId: string, resource: string, cursor: string, at: DateTime): Promise<void> {
    this.state.set(`${accountId}|${resource}`, { cursor, at });
  }

  async lastRunAt(accountId: string, resource: string): Promise<DateTime | null> {
    return this.state.get(`${accountId}|${resource}`)?.at ?? null;
  }

  async latestRunAt(accountId: string): Promise<DateTime | null> {
    let latest: DateTime | null = null;
    for (const [key, { at }] of this.state) {
      if (key.startsWith(`${accountId}|`) && (!latest || at > latest)) latest = at;
    }
    return latest;
  }

  deleteAccountData(accountId: string): void {
    for (const key of [...this.state.keys()]) if (key.startsWith(`${accountId}|`)) this.state.delete(key);
  }
}

export class InMemorySyncRequests implements SyncRequests {
  private readonly requested = new Map<string, Date>();
  private last = 0;

  async pending(): Promise<PendingSyncRequest[]> {
    return [...this.requested].map(([accountId, requestedAt]) => ({ accountId, requestedAt }));
  }

  async clear(accountId: string, observedAt: Date): Promise<void> {
    const at = this.requested.get(accountId);
    if (at && at.getTime() <= observedAt.getTime()) this.requested.delete(accountId);
  }

  async request(accountIds: string[]): Promise<void> {
    // Strictly increasing, so two requests never share a timestamp.
    this.last = Math.max(Date.now(), this.last + 1);
    for (const id of accountIds) this.requested.set(id, new Date(this.last));
  }
}

export class InMemoryMailRepository implements MailRepository {
  private readonly messages = new Map<string, Map<string, MailMessage>>();

  async applyChanges(accountId: string, changes: MailChange[]): Promise<void> {
    const byId = this.messages.get(accountId) ?? new Map<string, MailMessage>();
    this.messages.set(accountId, byId);
    for (const c of changes) {
      if (c.kind === 'upsert') byId.set(c.message.id, c.message);
      else byId.delete(c.messageId);
    }
  }

  async recentThreads(accountId: string, q: { since: DateTime; limit: number }): Promise<MailThreadSummary[]> {
    return this.summaries(accountId)
      .filter((t) => t.lastMessageAt >= q.since)
      .slice(0, q.limit);
  }

  async threadsAwaitingReply(accountId: string, own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> {
    return this.summaries(accountId)
      .filter((t) => !own.some((o) => o.equals(t.lastFrom)))
      .slice(0, limit);
  }

  async messageIdsSince(accountId: string, since: DateTime): Promise<string[]> {
    return [...(this.messages.get(accountId)?.values() ?? [])].filter((m) => m.date >= since).map((m) => m.id);
  }

  deleteAccountData(accountId: string): void {
    this.messages.delete(accountId);
  }

  /** Thread summaries for an account, newest first. */
  private summaries(accountId: string): MailThreadSummary[] {
    const byThread = new Map<string, MailMessage[]>();
    for (const m of this.messages.get(accountId)?.values() ?? []) {
      byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    }
    return [...byThread.entries()]
      .map(([id, msgs]) => this.summarize(accountId, id, msgs))
      .sort((a, b) => b.lastMessageAt.toMillis() - a.lastMessageAt.toMillis());
  }

  private summarize(accountId: string, id: string, msgs: MailMessage[]): MailThreadSummary {
    const sorted = [...msgs].sort((a, b) => a.date.toMillis() - b.date.toMillis());
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const participants: EmailAddress[] = [];
    for (const a of sorted.flatMap((m) => [m.from, ...m.to, ...m.cc])) {
      if (!participants.some((p) => p.equals(a))) participants.push(a);
    }
    const labels = [...new Set(sorted.flatMap((m) => m.labels))];
    return {
      id,
      accountId,
      subject: first.subject,
      lastMessageAt: last.date,
      unread: labels.includes('UNREAD'),
      labels,
      participants,
      lastFrom: last.from,
      snippet: last.snippet,
    };
  }
}

export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<string, CalendarEvent>();

  async applyChanges(accountId: string, changes: EventChange[]): Promise<void> {
    for (const c of changes) {
      if (c.kind === 'upsert') this.events.set(`${accountId}|${c.event.calendarId}|${c.event.id}`, c.event);
      else this.events.delete(`${accountId}|${c.calendarId}|${c.eventId}`);
    }
  }

  async inRange(accountIds: string[], range: TimeRange): Promise<CalendarEvent[]> {
    return [...this.events.values()]
      .filter((e) => accountIds.includes(e.accountId) && e.range.overlaps(range))
      .sort((a, b) => a.range.start.toMillis() - b.range.start.toMillis());
  }

  async eventIdsFrom(accountId: string, calendarId: string, from: DateTime): Promise<string[]> {
    const prefix = `${accountId}|${calendarId}|`;
    return [...this.events.entries()]
      .filter(([key, e]) => key.startsWith(prefix) && e.range.start >= from)
      .map(([, e]) => e.id);
  }

  deleteAccountData(accountId: string): void {
    for (const [key, e] of [...this.events.entries()]) if (e.accountId === accountId) this.events.delete(key);
  }
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly taskLists = new Map<string, TaskList>();
  private readonly tasks = new Map<string, Task>();

  async upsertLists(accountId: string, lists: TaskList[]): Promise<void> {
    for (const l of lists) this.taskLists.set(`${accountId}|${l.id}`, l);
  }

  async applyChanges(accountId: string, listId: string, changes: TaskChange[]): Promise<void> {
    for (const c of changes) {
      if (c.kind === 'upsert') this.tasks.set(`${accountId}|${listId}|${c.task.id}`, c.task);
      else this.tasks.delete(`${accountId}|${listId}|${c.taskId}`);
    }
  }

  /** Open, non-deleted tasks; with `dueBefore`, only tasks that have a due date strictly before it. */
  async open(q: { accountIds: string[]; dueBefore?: DateTime }): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      (t) =>
        q.accountIds.includes(t.accountId) &&
        t.status === 'open' &&
        !t.deleted &&
        (q.dueBefore === undefined || (t.due !== undefined && t.due < q.dueBefore)),
    );
  }

  async completed(q: { accountIds: string[] }): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      (t) => q.accountIds.includes(t.accountId) && t.status === 'completed' && !t.deleted,
    );
  }

  async taskIds(accountId: string, listId: string): Promise<string[]> {
    const prefix = `${accountId}|${listId}|`;
    return [...this.tasks.entries()].filter(([key]) => key.startsWith(prefix)).map(([, t]) => t.id);
  }

  async get(accountId: string, taskId: string): Promise<Task | null> {
    return [...this.tasks.values()].find((t) => t.accountId === accountId && t.id === taskId) ?? null;
  }

  async lists(accountIds: string[]): Promise<TaskList[]> {
    return [...this.taskLists.values()].filter((l) => accountIds.includes(l.accountId));
  }

  deleteAccountData(accountId: string): void {
    for (const [key, l] of [...this.taskLists.entries()]) if (l.accountId === accountId) this.taskLists.delete(key);
    for (const [key, t] of [...this.tasks.entries()]) if (t.accountId === accountId) this.tasks.delete(key);
  }
}

export class InMemoryPersonLinkLookup implements PersonLinkLookup {
  private linked = new Set<string>();

  setLinked(addresses: EmailAddress[]): void {
    this.linked = new Set(addresses.map((a) => a.address));
  }

  async isLinkedToAnyProject(email: EmailAddress): Promise<boolean> {
    return this.linked.has(email.address);
  }
}

export class InMemoryRepositories {
  readonly syncState = new InMemorySyncStateRepository();
  readonly mail = new InMemoryMailRepository();
  readonly events = new InMemoryEventRepository();
  readonly tasks = new InMemoryTaskRepository();
  readonly accounts = new InMemoryAccountRepository([this.syncState, this.mail, this.events, this.tasks]);
  readonly personLinks = new InMemoryPersonLinkLookup();
}
