import { beforeEach, describe, expect, it } from 'vitest';
import { appSettings, at, task, UseCaseFixture } from './use-case-fixture.test-support';
import { ListTasks } from './list-tasks';

describe('ListTasks', () => {
  let f: UseCaseFixture;
  const useCase = () => new ListTasks(f.repos.accounts, f.repos.tasks, appSettings());

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
    await f.repos.tasks.upsertLists('a1', [{ id: 'l1', accountId: 'a1', title: 'Inbox', isDefault: true }]);
    await f.repos.tasks.applyChanges('a1', 'l1', [
      { kind: 'upsert', task: task('open', 'a1', { due: at('2026-11-24T00:00:00') }) },
      { kind: 'upsert', task: task('done', 'a1', { status: 'completed' }) },
    ]);
  });

  it('defaults to open tasks with list title and zoned due', async () => {
    expect(await useCase().execute({})).toEqual([{ id: 'open', title: 'Task open', due: '2026-11-24T00:00:00.000-03:00', list: 'Inbox' }]);
  });

  it('completed returns only completed tasks; all returns both', async () => {
    expect((await useCase().execute({ status: 'completed' })).map((t) => t.id)).toEqual(['done']);
    expect((await useCase().execute({ status: 'all' })).map((t) => t.id)).toEqual(['open', 'done']);
  });
});
