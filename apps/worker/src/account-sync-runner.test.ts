import 'reflect-metadata';
import { EmailAddress, type Account, type SyncAccountResult } from '@jarvis/core';
import { InMemoryAccountRepository } from '@jarvis/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AccountSyncRunner } from './account-sync-runner';

const OK: SyncAccountResult = { status: 'active', resources: { mail: 'ok', calendar: 'ok', tasks: 'ok' }, fullResync: [] };

async function setup(accounts: [string, Account['status']][]) {
  const repo = new InMemoryAccountRepository();
  for (const [id, status] of accounts) {
    await repo.upsert({ id, provider: 'google', email: EmailAddress.parse(`${id}@example.com`), status });
  }
  const syncer = { execute: vi.fn().mockResolvedValue(OK) };
  return { runner: new AccountSyncRunner(repo, syncer, () => undefined), syncer };
}

describe('AccountSyncRunner', () => {
  it('reports the status of every synced account', async () => {
    const { runner } = await setup([['personal', 'active']]);
    expect(await runner.run()).toEqual([{ accountId: 'personal', status: 'active', result: OK }]);
  });

  it('reports needs_reauth accounts as skipped (not synced), so the summary shows them', async () => {
    const { runner, syncer } = await setup([
      ['personal', 'active'],
      ['work', 'needs_reauth'],
      ['old', 'disabled'],
    ]);
    expect(await runner.run()).toEqual([
      { accountId: 'personal', status: 'active', result: OK },
      { accountId: 'work', status: 'needs_reauth' },
    ]);
    expect(syncer.execute.mock.calls).toEqual([['personal']]);
  });

  it('takes the status from the sync result (reauth discovered during the run)', async () => {
    const { runner, syncer } = await setup([['personal', 'active']]);
    syncer.execute.mockResolvedValue({ ...OK, status: 'needs_reauth' });
    expect(await runner.run()).toEqual([
      { accountId: 'personal', status: 'needs_reauth', result: { ...OK, status: 'needs_reauth' } },
    ]);
  });
});
