import { beforeEach, describe, expect, it } from 'vitest';
import { appSettings, MONDAY_20, UseCaseFixture } from './use-case-fixture.test-support';
import { CreateTask } from './create-task';

describe('CreateTask', () => {
  let f: UseCaseFixture;
  let uc: CreateTask;

  beforeEach(async () => {
    f = new UseCaseFixture();
    const p = await f.addAccount('a1');
    p.tasks.seed([
      { id: 'l1', accountId: 'a1', title: 'Other', isDefault: false },
      { id: 'l2', accountId: 'a1', title: 'Mine', isDefault: true },
    ]);
    uc = new CreateTask(f.repos.accounts, f.repos.tasks, f.registry, appSettings());
  });

  it('creates in the default list with the due date at start of day in the zone, and stores it', async () => {
    const r = await uc.execute({ title: 'Pay', notes: 'n', due: '2026-11-24' });
    expect(r).toEqual({ id: 'task-1', title: 'Pay', due: '2026-11-24T00:00:00.000-03:00', list: 'Mine' });
    const stored = await f.repos.tasks.open({ accountIds: ['a1'] });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.listId).toBe('l2');
    expect(stored[0]!.due!.toMillis()).toBe(MONDAY_20.plus({ days: 1 }).startOf('day').toMillis());
    expect(stored[0]!.notes).toBe('n');
  });

  it('uses an explicit list and omits due when absent', async () => {
    const r = await uc.execute({ title: 'T', listId: 'l1' });
    expect(r).toEqual({ id: 'task-1', title: 'T', list: 'Other' });
  });

  it('rejects malformed dates', async () => {
    await expect(uc.execute({ title: 'T', due: '24/11/2026' })).rejects.toThrow('Invalid date: 24/11/2026');
  });
});
