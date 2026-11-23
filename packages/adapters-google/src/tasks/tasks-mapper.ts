import type { Task, TaskList } from '@jarvis/core';
import { DateTime } from 'luxon';
import type { tasks_v1 } from 'googleapis';

export class TasksMapper {
  constructor(
    private readonly accountId: string,
    private readonly zone: string,
  ) {}

  toList(l: tasks_v1.Schema$TaskList, isDefault: boolean): TaskList | null {
    return l.id ? { id: l.id, accountId: this.accountId, title: l.title ?? '', isDefault } : null;
  }

  toTask(t: tasks_v1.Schema$Task, listId: string): Task | null {
    if (!t.id) return null;
    const updatedAt = this.parse(t.updated) ?? DateTime.fromMillis(0, { zone: 'utc' });
    const task: Task = {
      id: t.id,
      accountId: this.accountId,
      listId,
      title: t.title ?? '',
      status: t.status === 'completed' ? 'completed' : 'open',
      updatedAt,
      deleted: t.deleted === true,
      raw: t,
    };
    if (t.notes) task.notes = t.notes;
    // Google Tasks sólo guarda la fecha (como medianoche UTC): se interpreta como el inicio de ese día en la zona.
    const dueDate = this.parse(t.due)?.toISODate();
    if (dueDate) task.due = DateTime.fromISO(dueDate, { zone: this.zone });
    const completed = this.parse(t.completed);
    if (completed) task.completedAt = completed;
    return task;
  }

  private parse(iso: string | null | undefined): DateTime | undefined {
    if (!iso) return undefined;
    const d = DateTime.fromISO(iso, { zone: 'utc' });
    return d.isValid ? d : undefined;
  }
}
