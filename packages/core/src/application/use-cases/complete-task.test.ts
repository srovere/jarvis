import { beforeEach, describe, expect, it } from 'vitest';
import { staticSettings, task, UseCaseFixture } from './use-case-fixture.test-support';
import { CompleteTask } from './complete-task';

describe('CompleteTask', () => {
  let f: UseCaseFixture;
  let uc: CompleteTask;

  beforeEach(async () => {
    f = new UseCaseFixture();
    const p = await f.addAccount('a1');
    const lists = [{ id: 'l1', accountId: 'a1', title: 'Mine', isDefault: true }];
    const t = task('t1', 'a1');
    p.tasks.seed(lists, [t]);
    await f.repos.tasks.upsertLists('a1', lists);
    await f.repos.tasks.applyChanges('a1', 'l1', [{ kind: 'upsert', task: t }]);
    uc = new CompleteTask(f.repos.accounts, f.repos.tasks, f.registry, staticSettings());
  });

  it('completes the task at the provider and leaves it completed in the DB', async () => {
    const r = await uc.execute({ taskId: 't1' });
    expect(r).toEqual({ id: 't1', accountId: 'a1', title: 'Task t1', list: 'Mine' });
    expect(await f.repos.tasks.open({ accountIds: ['a1'] })).toEqual([]);
    const done = await f.repos.tasks.completed({ accountIds: ['a1'] });
    expect(done.map((t) => t.id)).toEqual(['t1']);
  });

  it('fails for an unknown task', async () => {
    await expect(uc.execute({ taskId: 'nope' })).rejects.toThrow('Task not found: nope');
  });
});
