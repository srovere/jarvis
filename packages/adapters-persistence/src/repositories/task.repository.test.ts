import { EmailAddress, type Task } from '@jarvis/core';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleTaskRepository } from './task.repository';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    accountId: 'personal',
    listId: 'list1',
    title: `Task ${id}`,
    status: 'open',
    updatedAt: at('2026-11-20T10:00:00Z'),
    deleted: false,
    ...extra,
  };
}

describe('DrizzleTaskRepository', () => {
  const t = useTestDb();
  let repo: DrizzleTaskRepository;

  beforeEach(async () => {
    await new DrizzleAccountRepository(t.db()).upsert({
      id: 'personal',
      provider: 'google',
      email: EmailAddress.parse('me@example.com'),
      status: 'active',
    });
    repo = new DrizzleTaskRepository(t.db());
    await repo.upsertLists('personal', [{ id: 'list1', accountId: 'personal', title: 'My tasks', isDefault: true }]);
  });

  it('open excludes completed and deleted tasks', async () => {
    await repo.applyChanges('personal', 'list1', [
      { kind: 'upsert', task: task('open') },
      { kind: 'upsert', task: task('done', { status: 'completed', completedAt: at('2026-11-21T10:00:00Z') }) },
      { kind: 'upsert', task: task('gone', { deleted: true }) },
    ]);
    const got = await repo.open({ accountIds: ['personal'] });
    expect(got.map((x) => x.id)).toEqual(['open']);
  });

  it('dueBefore keeps only tasks due strictly before the bound', async () => {
    await repo.applyChanges('personal', 'list1', [
      { kind: 'upsert', task: task('soon', { due: at('2026-11-24T00:00:00Z') }) },
      { kind: 'upsert', task: task('later', { due: at('2026-12-24T00:00:00Z') }) },
      { kind: 'upsert', task: task('nodue') },
    ]);
    const got = await repo.open({ accountIds: ['personal'], dueBefore: at('2026-11-30T00:00:00Z') });
    expect(got.map((x) => x.id)).toEqual(['soon']);
  });

  it('upsert twice keeps one row, delete removes it, and the domain task round-trips', async () => {
    const full = task('t1', {
      notes: 'n',
      due: at('2026-11-24T00:00:00Z'),
      createdAt: at('2026-11-01T00:00:00Z'),
      raw: { x: 1 },
    });
    await repo.applyChanges('personal', 'list1', [{ kind: 'upsert', task: full }]);
    await repo.applyChanges('personal', 'list1', [{ kind: 'upsert', task: { ...full, title: 'Renamed' } }]);
    const got = await repo.open({ accountIds: ['personal'] });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: 't1', listId: 'list1', accountId: 'personal', title: 'Renamed', notes: 'n', deleted: false, raw: { x: 1 } });
    expect(got[0]!.due!.toMillis()).toBe(full.due!.toMillis());
    expect(got[0]!.updatedAt.toMillis()).toBe(full.updatedAt.toMillis());
    await repo.applyChanges('personal', 'list1', [{ kind: 'delete', taskId: 't1' }]);
    expect(await repo.open({ accountIds: ['personal'] })).toEqual([]);
  });

  it('upsertLists updates an existing list instead of duplicating it', async () => {
    await repo.upsertLists('personal', [{ id: 'list1', accountId: 'personal', title: 'Renamed', isDefault: false }]);
    await repo.applyChanges('personal', 'list1', [{ kind: 'upsert', task: task('t1') }]);
    expect(await repo.open({ accountIds: ['personal'] })).toHaveLength(1);
  });
});
