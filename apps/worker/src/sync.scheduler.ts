import { LOG_SINK, type LogSink } from '@jarvis/composition';
import { activeAccounts, TOKENS, type AccountRepository, type Clock, type SyncStateRepository } from '@jarvis/core';
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AccountSyncRunner } from './account-sync-runner';
import { CatchUp } from './catch-up';

export const SYNC_SCHEDULER_OPTIONS = Symbol('SyncSchedulerOptions');

export interface SyncSchedulerOptions {
  intervalMinutes: number;
}

/**
 * Syncs every active account each `intervalMinutes` (read from the configuration at runtime). On start it
 * catches up right away when an account's last mail sync is overdue. A tick is skipped while one is running.
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  static readonly INTERVAL_NAME = 'jarvis-sync';
  private running: Promise<void> | null = null;

  // Explicit @Inject everywhere: no reliance on emitted design:paramtypes (tsx/esbuild does not emit them).
  constructor(
    @Inject(AccountSyncRunner) private readonly runner: AccountSyncRunner,
    @Inject(TOKENS.SyncStateRepository) private readonly syncState: SyncStateRepository,
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Inject(SYNC_SCHEDULER_OPTIONS) private readonly options: SyncSchedulerOptions,
    @Inject(LOG_SINK) private readonly log: LogSink,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const handle = setInterval(() => void this.tick(), this.options.intervalMinutes * 60_000);
    this.registry.addInterval(SyncScheduler.INTERVAL_NAME, handle);
    // In the background: a long first sync must not block startup (nor the shutdown hooks).
    if (await this.isOverdue()) void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.registry.doesExist('interval', SyncScheduler.INTERVAL_NAME)) {
      this.registry.deleteInterval(SyncScheduler.INTERVAL_NAME);
    }
    await this.idle();
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

  private async isOverdue(): Promise<boolean> {
    const now = this.clock.now();
    for (const { id } of await activeAccounts(this.accounts)) {
      if (CatchUp.isOverdue(await this.syncState.lastRunAt(id, 'mail'), now, this.options.intervalMinutes)) return true;
    }
    return false;
  }
}
