import { describe, expect, it } from 'vitest';
import type { TaskChange, TaskReader, TaskWriter } from '@jarvis/core';

export interface TasksContractSetup {
  reader: TaskReader;
  writer: TaskWriter;
}

const upserts = (changes: TaskChange[]) => changes.flatMap((c) => (c.kind === 'upsert' ? [c.task] : []));

export function describeTasksContract(name: string, setup: () => Promise<TasksContractSetup>): void {
  describe(`Tasks contract: ${name}`, () => {
    it('createList is visible in listLists', async () => {
      const { reader, writer } = await setup();
      const list = await writer.createList('Jarvis');
      expect((await reader.listLists()).map((l) => l.id)).toContain(list.id);
    });

    it('createTask returns an open task in the list', async () => {
      const { writer } = await setup();
      const list = await writer.createList('Jarvis');
      const task = await writer.createTask(list.id, { title: 'Pagar', notes: 'urgente' });
      expect(task.id).not.toBe('');
      expect(task.listId).toBe(list.id);
      expect(task.title).toBe('Pagar');
      expect(task.status).toBe('open');
      expect(task.notes).toBe('urgente');
    });

    it('completeTask leaves status completed with completedAt', async () => {
      const { reader, writer } = await setup();
      const list = await writer.createList('Jarvis');
      const task = await writer.createTask(list.id, { title: 'Pagar' });
      const done = await writer.completeTask(list.id, task.id);
      expect(done.id).toBe(task.id);
      expect(done.status).toBe('completed');
      expect(done.completedAt).toBeDefined();
      const synced = upserts((await reader.sync(list.id, null)).changes).find((t) => t.id === task.id);
      expect(synced?.status).toBe('completed');
    });

    it('sync(null) returns a non-empty cursor and sync(nextCursor) without changes is empty', async () => {
      const { reader, writer } = await setup();
      const list = await writer.createList('Jarvis');
      await writer.createTask(list.id, { title: 'A' });
      const full = await reader.sync(list.id, null);
      expect(full.nextCursor).not.toBe('');
      expect(full.fullResync).toBe(true);
      expect(upserts(full.changes).map((t) => t.title)).toContain('A');
      const again = await reader.sync(list.id, full.nextCursor);
      expect(again.changes).toEqual([]);
      expect(again.fullResync).toBe(false);
    });

    it('sync(cursor) after createTask contains an upsert for the new task', async () => {
      const { reader, writer } = await setup();
      const list = await writer.createList('Jarvis');
      const first = await reader.sync(list.id, null);
      const task = await writer.createTask(list.id, { title: 'B' });
      const next = await reader.sync(list.id, first.nextCursor);
      expect(upserts(next.changes).map((t) => t.id)).toContain(task.id);
    });
  });
}
