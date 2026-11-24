import { LOG_SINK, type LogSink } from '@jarvis/composition';
import {
  activeAccounts,
  TOKENS,
  type AccountRepository,
  type Clock,
  type SettingsProvider,
  type SyncRequests,
  type SyncStateRepository,
} from '@jarvis/core';
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AccountSyncRunner } from './account-sync-runner';
import { CatchUp } from './catch-up';

/** Injection token of the `SyncRequests` source, bound by the worker's composition. */
export const SYNC_REQUESTS = Symbol('SyncRequests');

/** How often the worker looks for a changed sync interval and for accounts with a pending sync request. */
export const POLL_MS = 30_000;

/**
 * Syncs every active account each `sync.intervalMinutes`, read from the settings at runtime: a change is picked
 * up within `POLL_MS` and the interval is re-scheduled. Accounts with a pending sync request are synced on that
 * same poll. On start it catches up right away when an account's last mail sync is overdue. A tick is skipped
 * while one is running.
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  static readonly INTERVAL_NAME = 'jarvis-sync';
  static readonly POLL_NAME = 'jarvis-sync-poll';
  private scheduledMinutes: number | null = null;
  private running: Promise<void> | null = null;

  // Explicit @Inject everywhere: no reliance on emitted design:paramtypes (tsx/esbuild does not emit them).
  constructor(
    @Inject(AccountSyncRunner) private readonly runner: AccountSyncRunner,
    @Inject(TOKENS.SyncStateRepository) private readonly syncState: SyncStateRepository,
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Inject(TOKENS.SettingsProvider) private readonly settings: SettingsProvider,
    @Inject(SYNC_REQUESTS) private readonly requests: SyncRequests,
    @Inject(LOG_SINK) private readonly log: LogSink,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { intervalMinutes } = (await this.settings.current()).sync;
    this.schedule(intervalMinutes);
    this.registry.addInterval(SyncScheduler.POLL_NAME, setInterval(() => void this.poll(), POLL_MS));
    // In the background: a long first sync must not block startup (nor the shutdown hooks).
    if (await this.isOverdue(intervalMinutes)) void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    for (const name of [SyncScheduler.INTERVAL_NAME, SyncScheduler.POLL_NAME]) {
      if (this.registry.doesExist('interval', name)) this.registry.deleteInterval(name);
    }
    await this.idle();
  }

  /** Re-schedules the sync interval when the setting changed, then syncs the accounts that asked for it. */
  async poll(): Promise<void> {
    try {
      const { intervalMinutes } = (await this.settings.current()).sync;
      if (intervalMinutes !== this.scheduledMinutes) this.schedule(intervalMinutes);
      await this.syncRequested();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.log(JSON.stringify({ level: 'error', msg: 'sync poll failed', error }));
    }
  }

  private schedule(intervalMinutes: number): void {
    if (this.registry.doesExist('interval', SyncScheduler.INTERVAL_NAME)) {
      this.registry.deleteInterval(SyncScheduler.INTERVAL_NAME);
    }
    this.registry.addInterval(
      SyncScheduler.INTERVAL_NAME,
      setInterval(() => void this.tick(), intervalMinutes * 60_000),
    );
    this.scheduledMinutes = intervalMinutes;
  }

  /** Syncs each account with a pending request and clears it; left pending while a tick is running. */
  private async syncRequested(): Promise<void> {
    if (this.running) return;
    const ids = await this.requests.pending();
    if (ids.length === 0) return;
    this.running = this.syncAccounts(ids).finally(() => {
      this.running = null;
    });
    await this.running;
  }

  private async syncAccounts(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        const [outcome] = await this.runner.run(id);
        this.log(JSON.stringify({ level: 'info', msg: 'requested sync finished', accountId: id, error: outcome?.error }));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.log(JSON.stringify({ level: 'error', msg: 'requested sync failed', accountId: id, error }));
      }
      await this.requests.clear(id);
    }
  }

  /** Syncs all active accounts serially; resolves immediately (skipping) if a previous tick is still running. */
  tick(): Promise<void> {
    if (this.running) {
      this.log(JSON.stringify({ level: 'warn', msg: 'sync tick skipped: previous run still in progress' }));
      return Promise.resolve();
    }
    this.running = this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Resolves when no tick is running. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async runOnce(): Promise<void> {
    try {
      const outcomes = await this.runner.run();
      const failed = outcomes.filter((o) => o.error !== undefined).length;
      this.log(JSON.stringify({ level: 'info', msg: 'sync finished', accounts: outcomes.length, failed }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.log(JSON.stringify({ level: 'error', msg: 'sync run failed', error }));
    }
  }

  private async isOverdue(intervalMinutes: number): Promise<boolean> {
    const now = this.clock.now();
    for (const { id } of await activeAccounts(this.accounts)) {
      if (CatchUp.isOverdue(await this.syncState.lastRunAt(id, 'mail'), now, intervalMinutes)) return true;
    }
    return false;
  }
}
