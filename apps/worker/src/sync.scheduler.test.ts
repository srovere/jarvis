import 'reflect-metadata';
import { EmailAddress, type Account, type SyncAccountResult } from '@jarvis/core';
import { FixedClock, InMemoryAccountRepository, InMemorySyncStateRepository } from '@jarvis/core/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSyncRunner, type AccountSyncer } from './account-sync-runner';
import { SyncScheduler } from './sync.scheduler';

const NOW = DateTime.fromISO('2026-11-23T10:00:00Z');
const OK: SyncAccountResult = { resources: { mail: 'ok', calendar: 'ok', tasks: 'ok' }, fullResync: [] };

function account(id: string, status: Account['status'] = 'active'): Account {
  return { id, provider: 'google', email: EmailAddress.parse(`${id}@example.com`), status };
}

async function setup(accounts: Account[], execute: AccountSyncer['execute'] = vi.fn().mockResolvedValue(OK)) {
  const repo = new InMemoryAccountRepository();
  for (const a of accounts) await repo.upsert(a);
  const syncState = new InMemorySyncStateRepository();
  const clock = new FixedClock(NOW);
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const syncer = { execute: vi.fn(execute) };
  const registry = new SchedulerRegistry();
  const runner = new AccountSyncRunner(repo, syncer, log);
  const scheduler = new SyncScheduler(runner, syncState, repo, clock, registry, { intervalMinutes: 5 }, log);
  return { scheduler, syncer, syncState, registry, lines };
}

describe('SyncScheduler', () => {
  let toStop: SyncScheduler | undefined;
  afterEach(async () => {
    await toStop?.onModuleDestroy();
    toStop = undefined;
  });

  it('syncs only active accounts, serially', async () => {
    const { scheduler, syncer } = await setup([account('personal'), account('work', 'needs_reauth')]);
    await scheduler.tick();
    expect(syncer.execute.mock.calls).toEqual([['personal']]);
  });

  it('skips a tick while the previous one is still running', async () => {
    let release!: () => void;
    const pending = new Promise<SyncAccountResult>((resolve) => (release = () => resolve(OK)));
    const { scheduler, syncer, lines } = await setup([account('personal')], () => pending);

    const first = scheduler.tick();
    await vi.waitFor(() => expect(syncer.execute).toHaveBeenCalledTimes(1));
    await scheduler.tick();
    expect(syncer.execute).toHaveBeenCalledTimes(1);
    expect(lines.map((l) => JSON.parse(l).msg)).toContain('sync tick skipped: previous run still in progress');

    release();
    await first;
    syncer.execute.mockResolvedValue(OK);
    await scheduler.tick();
    expect(syncer.execute).toHaveBeenCalledTimes(2);
  });

  it('isolates per-account errors and logs them as JSON', async () => {
    const execute = vi.fn(async (id: string) => {
      if (id === 'personal') throw new Error('provider down');
      return OK;
    });
    const { scheduler, syncer, lines } = await setup([account('personal'), account('work')], execute);
    await scheduler.tick();
    expect(syncer.execute.mock.calls).toEqual([['personal'], ['work']]);
    expect(lines.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ accountId: 'personal', error: 'provider down' }),
    );
  });

  it('on bootstrap catches up when an account is overdue and registers the interval', async () => {
    const { scheduler, syncer, registry } = await setup([account('personal')]);
    toStop = scheduler;
    await scheduler.onApplicationBootstrap();
    await scheduler.idle();
    expect(syncer.execute).toHaveBeenCalledWith('personal');
    expect(registry.doesExist('interval', SyncScheduler.INTERVAL_NAME)).toBe(true);
  });

  it('on bootstrap does not sync when every active account ran recently', async () => {
    const { scheduler, syncer, syncState } = await setup([account('personal')]);
    toStop = scheduler;
    await syncState.set('personal', 'mail', 'c1', NOW.minus({ minutes: 4 }));
    await scheduler.onApplicationBootstrap();
    await scheduler.idle();
    expect(syncer.execute).not.toHaveBeenCalled();
  });

  it('runs a tick on every interval', async () => {
    vi.useFakeTimers();
    try {
      const { scheduler, syncer, syncState } = await setup([account('personal')]);
      toStop = scheduler;
      await syncState.set('personal', 'mail', 'c1', NOW);
      await scheduler.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(syncer.execute).toHaveBeenCalledTimes(1);
      await scheduler.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(syncer.execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
