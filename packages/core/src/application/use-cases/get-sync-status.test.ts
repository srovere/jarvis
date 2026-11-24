import { beforeEach, describe, expect, it } from 'vitest';
import { GetSyncStatus } from './get-sync-status';
import { at, UseCaseFixture } from './use-case-fixture.test-support';

describe('GetSyncStatus', () => {
  let f: UseCaseFixture;

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
    await f.addAccount('re', 'needs_reauth');
    await f.addAccount('gone', 'disabled');
    await f.repos.accounts.setMissingScopes('re', ['scope-x']);
    await f.repos.syncState.set('a1', 'mail', 'c', at('2026-11-23T09:00:00'));
    await f.repos.syncState.set('a1', 'calendar', 'c', at('2026-11-23T09:30:00'));
  });

  it('reports every non-disabled account with its latest sync time', async () => {
    const got = await new GetSyncStatus(f.repos.accounts, f.repos.syncState).execute();
    expect(got).toEqual([
      { accountId: 'a1', email: 'a1@example.com', status: 'active', lastSyncAt: at('2026-11-23T09:30:00').toUTC().toISO(), missingScopes: [] },
      { accountId: 're', email: 're@example.com', status: 'needs_reauth', lastSyncAt: null, missingScopes: ['scope-x'] },
    ]);
  });
});
