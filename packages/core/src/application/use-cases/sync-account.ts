import { CursorExpired, ReauthRequired } from '../../domain/errors';
import type { CalendarReader } from '../../domain/ports/calendar';
import type { Clock } from '../../domain/ports/clock';
import type { MailReader } from '../../domain/ports/mail';
import type { ProviderBundle } from '../../domain/ports/provider';
import type {
  AccountRepository,
  EventRepository,
  MailRepository,
  SyncStateRepository,
  TaskRepository,
} from '../../domain/ports/repositories';
import type { TaskReader } from '../../domain/ports/tasks';
import { busyCalendarsOf, type AppSettings } from '../config';
import type { ProviderRegistry } from '../provider-registry';

export type SyncResourceKind = 'mail' | 'calendar' | 'tasks';
export type SyncResourceStatus = 'ok' | 'skipped' | 'error';

export interface SyncAccountResult {
  resources: Record<SyncResourceKind, SyncResourceStatus>;
  /** Resource keys (`mail`, `calendar:<id>`, `tasks:<listId>`) that went through a full resync. */
  fullResync: string[];
}

/** One cursor-tracked resource: fetches from `cursor`, stores the changes and returns the new cursor. */
interface SyncUnit {
  key: string;
  run(cursor: string | null): Promise<{ nextCursor: string; fullResync: boolean }>;
}

/**
 * Window the calendar adapter resyncs from (now − 30 days). Must equal `INITIAL_WINDOW_DAYS` in
 * adapters-google `google-calendar-adapter.ts`: a larger value here would delete valid events older than
 * the adapter's snapshot window.
 */
const CALENDAR_RESYNC_DAYS = 30;

/**
 * Syncs every resource of one account into the repositories. On a full resync, stored items inside the
 * resync window that the snapshot no longer contains are deleted. `ReauthRequired` marks the account
 * `needs_reauth` and stops; any other error marks that resource as failed and moves on.
 */
export class SyncAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
    private readonly syncState: SyncStateRepository,
    private readonly mail: MailRepository,
    private readonly events: EventRepository,
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
    private readonly settings: AppSettings,
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  async execute(accountId: string): Promise<SyncAccountResult> {
    const result: SyncAccountResult = {
      resources: { mail: 'skipped', calendar: 'skipped', tasks: 'skipped' },
      fullResync: [],
    };
    const account = await this.accounts.get(accountId);
    try {
      const bundle = await this.registry.forAccount(account);
      for (const [kind, units] of this.plan(accountId, bundle)) {
        if (!units) continue;
        result.resources[kind] = 'error'; // stays so if ReauthRequired interrupts this kind
        result.resources[kind] = await this.syncKind(accountId, kind, units, result);
      }
    } catch (e) {
      if (!(e instanceof ReauthRequired)) throw e;
      await this.accounts.setStatus(accountId, 'needs_reauth', `ejecutá pnpm jarvis auth --account ${accountId}`);
    }
    return result;
  }

  /** Per kind, a loader of its sync units, or `undefined` when the bundle lacks that capability. */
  private plan(
    accountId: string,
    b: ProviderBundle,
  ): [SyncResourceKind, (() => Promise<SyncUnit[]>) | undefined][] {
    const { mail, calendar, tasks } = b;
    return [
      ['mail', mail && (async () => [this.mailUnit(accountId, mail)])],
      [
        'calendar',
        calendar &&
          (async () => busyCalendarsOf(this.settings, accountId).map((id) => this.calendarUnit(accountId, calendar, id))),
      ],
      ['tasks', tasks && (() => this.taskUnits(accountId, tasks))],
    ];
  }

  private async syncKind(
    accountId: string,
    kind: SyncResourceKind,
    loadUnits: () => Promise<SyncUnit[]>,
    result: SyncAccountResult,
  ): Promise<SyncResourceStatus> {
    let units: SyncUnit[];
    try {
      units = await loadUnits();
    } catch (e) {
      this.fail(accountId, kind, e);
      return 'error';
    }
    let status: SyncResourceStatus = 'ok';
    for (const unit of units) {
      try {
        if (await this.syncUnit(accountId, unit)) result.fullResync.push(unit.key);
      } catch (e) {
        this.fail(accountId, unit.key, e);
        status = 'error';
      }
    }
    return status;
  }

  /** Runs the unit from its stored cursor (retrying once from scratch on `CursorExpired`) and saves the new cursor. */
  private async syncUnit(accountId: string, unit: SyncUnit): Promise<boolean> {
    const cursor = await this.syncState.get(accountId, unit.key);
    let outcome: { nextCursor: string; fullResync: boolean };
    try {
      outcome = await unit.run(cursor);
    } catch (e) {
      if (!(e instanceof CursorExpired) || cursor === null) throw e;
      outcome = await unit.run(null);
    }
    await this.syncState.set(accountId, unit.key, outcome.nextCursor, this.clock.now());
    return outcome.fullResync;
  }

  /** Rethrows `ReauthRequired` (it stops the account); logs anything else without content. */
  private fail(accountId: string, resource: string, e: unknown): void {
    if (e instanceof ReauthRequired) throw e;
    const error = e instanceof Error ? e.message : String(e);
    this.log(JSON.stringify({ level: 'error', msg: 'sync resource failed', accountId, resource, error }));
  }

  private mailUnit(accountId: string, reader: MailReader): SyncUnit {
    const windowDays = this.settings.sync.gmailInitialWindowDays;
    return {
      key: 'mail',
      run: async (cursor) => {
        const r = await reader.sync(cursor, { initialWindowDays: windowDays });
        await this.mail.applyChanges(accountId, r.changes);
        if (r.fullResync) {
          const kept = new Set(r.changes.flatMap((c) => (c.kind === 'upsert' ? [c.message.id] : [])));
          const stored = await this.mail.messageIdsSince(accountId, this.clock.now().minus({ days: windowDays }));
          const stale = stored.filter((id) => !kept.has(id));
          if (stale.length > 0) {
            await this.mail.applyChanges(accountId, stale.map((messageId) => ({ kind: 'delete' as const, messageId })));
          }
        }
        return r;
      },
    };
  }

  private calendarUnit(accountId: string, reader: CalendarReader, calendarId: string): SyncUnit {
    return {
      key: `calendar:${calendarId}`,
      run: async (cursor) => {
        const r = await reader.sync(calendarId, cursor);
        await this.events.applyChanges(accountId, r.changes);
        if (r.fullResync) {
          const kept = new Set(r.changes.flatMap((c) => (c.kind === 'upsert' ? [c.event.id] : [])));
          const from = this.clock.now().minus({ days: CALENDAR_RESYNC_DAYS });
          const stale = (await this.events.eventIdsFrom(accountId, calendarId, from)).filter((id) => !kept.has(id));
          if (stale.length > 0) {
            await this.events.applyChanges(
              accountId,
              stale.map((eventId) => ({ kind: 'delete' as const, eventId, calendarId })),
            );
          }
        }
        return r;
      },
    };
  }

  private async taskUnits(accountId: string, reader: TaskReader): Promise<SyncUnit[]> {
    const lists = await reader.listLists();
    await this.tasks.upsertLists(accountId, lists);
    return lists.map((list) => ({
      key: `tasks:${list.id}`,
      run: async (cursor) => {
        const r = await reader.sync(list.id, cursor);
        await this.tasks.applyChanges(accountId, list.id, r.changes);
        if (r.fullResync) {
          const kept = new Set(r.changes.flatMap((c) => (c.kind === 'upsert' ? [c.task.id] : [])));
          const stale = (await this.tasks.taskIds(accountId, list.id)).filter((id) => !kept.has(id));
          if (stale.length > 0) {
            await this.tasks.applyChanges(accountId, list.id, stale.map((taskId) => ({ kind: 'delete' as const, taskId })));
          }
        }
        return r;
      },
    }));
  }
}
