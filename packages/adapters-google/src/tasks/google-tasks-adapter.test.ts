import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { FakeTasks } from './__fixtures__/fake-tasks';
import { GoogleTasksAdapter } from './google-tasks-adapter';

function setup(opts: ConstructorParameters<typeof FakeTasks>[0] = {}) {
  const fake = new FakeTasks(opts);
  return { fake, adapter: new GoogleTasksAdapter(fake.asTasks(), 'acc') };
}

describe('GoogleTasksAdapter', () => {
  it('marks only the first list as default', async () => {
    const { fake, adapter } = setup();
    fake.addList('Otra');
    const lists = await adapter.listLists();
    expect(lists.map((l) => [l.title, l.isDefault])).toEqual([['My Tasks', true], ['Otra', false]]);
  });

  it('maps due as midnight UTC of the date, completed timestamps and status', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    fake.seed(list!.id, {
      id: 't1',
      title: 'Hecha',
      status: 'completed',
      due: '2026-11-24T00:00:00.000Z',
      completed: '2026-11-23T15:30:00.000Z',
    });
    const r = await adapter.sync(list!.id, null);
    const c = r.changes[0]!;
    if (c.kind !== 'upsert') throw new Error('expected upsert');
    expect(c.task.status).toBe('completed');
    expect(c.task.due!.toISO()).toBe('2026-11-24T00:00:00.000Z');
    expect(c.task.completedAt!.toMillis()).toBe(Date.parse('2026-11-23T15:30:00.000Z'));
  });

  it('sync requests completed, hidden and deleted tasks; cursor is the max updated seen', async () => {
    const { fake, adapter } = setup({ pageSize: 1 });
    const [list] = await adapter.listLists();
    fake.seed(list!.id, { id: 'a', title: 'A' });
    const id = fake.seed(list!.id, { id: 'b', title: 'B' });
    const bUpdated = (await adapter.sync(list!.id, null)).changes.flatMap((c) => (c.kind === 'upsert' ? [c.task] : [])).find((t) => t.id === id)!
      .updatedAt;
    const r = await adapter.sync(list!.id, null);
    expect(fake.calls.tasksList.mock.calls[0]![0]).toMatchObject({ showCompleted: true, showHidden: true, showDeleted: true });
    expect(r.changes).toHaveLength(2);
    expect(DateTime.fromISO(r.nextCursor).toMillis()).toBe(bUpdated.toMillis());
  });

  it('a deleted task becomes a delete change and incremental sync passes updatedMin', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    fake.seed(list!.id, { id: 't1', title: 'X' });
    const first = await adapter.sync(list!.id, null);
    fake.markDeleted(list!.id, 't1');
    const next = await adapter.sync(list!.id, first.nextCursor);
    expect(next.changes).toEqual([{ kind: 'delete', taskId: 't1' }]);
    expect(next.fullResync).toBe(false);
    expect(fake.calls.tasksList.mock.calls.at(-1)![0].updatedMin).toBe(first.nextCursor);
  });

  it('createTask sends due as RFC3339 midnight UTC of the given date', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    const due = DateTime.fromISO('2026-12-05T18:00:00', { zone: 'America/Argentina/Buenos_Aires' });
    const t = await adapter.createTask(list!.id, { title: 'Pagar', notes: 'n', due });
    expect(fake.calls.tasksInsert).toHaveBeenCalledWith({
      tasklist: list!.id,
      requestBody: { title: 'Pagar', notes: 'n', due: '2026-12-05T00:00:00.000Z' },
    });
    expect(t.due!.toISO()).toBe('2026-12-05T00:00:00.000Z');
  });

  it('completeTask patches status completed', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    const t = await adapter.createTask(list!.id, { title: 'Pagar' });
    const done = await adapter.completeTask(list!.id, t.id);
    expect(fake.calls.tasksPatch).toHaveBeenCalledWith({ tasklist: list!.id, task: t.id, requestBody: { status: 'completed' } });
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeDefined();
  });
});
