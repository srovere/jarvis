import { beforeEach, describe, expect, it } from 'vitest';
import { ListTaskLists } from './list-task-lists';
import { UseCaseFixture } from './use-case-fixture.test-support';

describe('ListTaskLists', () => {
  let f: UseCaseFixture;

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
    await f.addAccount('a2');
    await f.addAccount('off', 'needs_reauth');
    await f.repos.tasks.upsertLists('a1', [{ id: 'l1', accountId: 'a1', title: 'My tasks', isDefault: true }]);
    await f.repos.tasks.upsertLists('a2', [{ id: 'l2', accountId: 'a2', title: 'Work', isDefault: true }]);
    await f.repos.tasks.upsertLists('off', [{ id: 'l3', accountId: 'off', title: 'Old', isDefault: true }]);
  });

  it('lists the synced task lists of the active accounts', async () => {
    const got = await new ListTaskLists(f.repos.accounts, f.repos.tasks).execute();
    expect(got).toEqual([
      { accountId: 'a1', id: 'l1', title: 'My tasks' },
      { accountId: 'a2', id: 'l2', title: 'Work' },
    ]);
  });
});
