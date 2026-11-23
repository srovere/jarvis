import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { FakeTasks } from './__fixtures__/fake-tasks';
import { GoogleTasksAdapter } from './google-tasks-adapter';

const ZONE = 'America/Argentina/Buenos_Aires';

function setup(opts: ConstructorParameters<typeof FakeTasks>[0] = {}) {
  const fake = new FakeTasks(opts);
  return { fake, adapter: new GoogleTasksAdapter(fake.asTasks(), 'acc', ZONE) };
}

describe('GoogleTasksAdapter', () => {
  it('marks only the first list as default', async () => {
    const { fake, adapter } = setup();
    fake.addList('Otra');
    const lists = await adapter.listLists();
    expect(lists.map((l) => [l.title, l.isDefault])).toEqual([['My Tasks', true], ['Otra', false]]);
  });

  it('maps the date-only due to the start of that date in the zone, completed timestamps and status', async () => {
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
    expect(c.task.due!.toISO()).toBe('2026-11-24T00:00:00.000-03:00');
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
    expect(DateTime.fromISO(r.nextCursor.split('|')[0]!).toMillis()).toBe(bUpdated.toMillis());
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
    expect(fake.calls.tasksList.mock.calls.at(-1)![0].updatedMin).toBe(first.nextCursor.split('|')[0]);
  });

  it('createTask sends due as RFC3339 midnight UTC of its date in the zone', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    const due = DateTime.fromISO('2026-12-05T18:00:00', { zone: 'America/Argentina/Buenos_Aires' });
    const t = await adapter.createTask(list!.id, { title: 'Pagar', notes: 'n', due });
    expect(fake.calls.tasksInsert).toHaveBeenCalledWith({
      tasklist: list!.id,
      requestBody: { title: 'Pagar', notes: 'n', due: '2026-12-05T00:00:00.000Z' },
    });
    expect(t.due!.toISO()).toBe('2026-12-05T00:00:00.000-03:00');
  });

  it('createTask takes the date in the zone, not the DateTime own zone', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    await adapter.createTask(list!.id, { title: 'Tarde', due: DateTime.fromISO('2026-12-06T01:00:00Z', { zone: 'utc' }) });
    expect(fake.calls.tasksInsert.mock.calls[0]![0].requestBody.due).toBe('2026-12-05T00:00:00.000Z');
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

  it('redelivers a task updated at exactly the cursor millisecond (lossless cursor)', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    const T = '2026-11-23T10:00:00.000Z';
    fake.seed(list!.id, { id: 'A', title: 'A', updated: T });
    const first = await adapter.sync(list!.id, null);
    expect((await adapter.sync(list!.id, first.nextCursor)).changes).toEqual([]);
    fake.seed(list!.id, { id: 'B', title: 'B', updated: T });
    const next = await adapter.sync(list!.id, first.nextCursor);
    expect(next.changes.map((c) => (c.kind === 'upsert' ? c.task.id : c.taskId))).toEqual(['B']);
    const again = await adapter.sync(list!.id, next.nextCursor);
    expect(again.changes).toEqual([]);
  });

  it('accepts a legacy plain-ISO cursor', async () => {
    const { fake, adapter } = setup();
    const [list] = await adapter.listLists();
    fake.seed(list!.id, { id: 'A', title: 'A', updated: '2026-11-23T10:00:00.000Z' });
    const r = await adapter.sync(list!.id, '2026-11-23T09:00:00.000Z');
    expect(r.changes).toHaveLength(1);
  });
});
