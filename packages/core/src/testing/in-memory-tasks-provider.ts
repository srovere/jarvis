import { CursorExpired, DomainError } from '../domain/errors';
import type { Task, TaskList } from '../domain/model/tasks';
import type { Clock } from '../domain/ports/clock';
import type { SyncResult } from '../domain/ports/mail';
import type { TaskChange, TaskReader, TaskWriter } from '../domain/ports/tasks';
import type { DateTime } from 'luxon';
import { ChangeLog } from './change-log';

export class InMemoryTasksProvider implements TaskReader, TaskWriter {
  private readonly lists: TaskList[] = [];
  private readonly tasks = new Map<string, Task>();
  private readonly log = new ChangeLog<string, TaskChange>();
  private readonly accountId: string;
  private readonly clock: Clock;
  private nextId = 1;

  constructor(opts: { accountId: string; clock: Clock }) {
    this.accountId = opts.accountId;
    this.clock = opts.clock;
  }

  seed(lists: TaskList[], tasks: Task[] = []): void {
    this.lists.push(...lists);
    for (const task of tasks) this.store(task);
  }

  async listLists(): Promise<TaskList[]> {
    return [...this.lists];
  }

  async sync(listId: string, cursor: string | null): Promise<SyncResult<TaskChange>> {
    const nextCursor = this.log.currentCursor;
    if (cursor === null) {
      const changes = [...this.tasks.values()]
        .filter((t) => t.listId === listId)
        .map((task): TaskChange => ({ kind: 'upsert', task }));
      return { changes, nextCursor, fullResync: true };
    }
    if (!/^\d+$/.test(cursor)) throw new CursorExpired(`Invalid cursor: ${cursor}`);
    return { changes: this.log.since(cursor, (k) => k === listId), nextCursor, fullResync: false };
  }

  async createTask(listId: string, t: { title: string; notes?: string; due?: DateTime }): Promise<Task> {
    this.requireList(listId);
    const now = this.clock.now();
    const task: Task = {
      id: `task-${this.nextId++}`,
      accountId: this.accountId,
      listId,
      title: t.title,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    };
    if (t.notes !== undefined) task.notes = t.notes;
    if (t.due !== undefined) task.due = t.due;
    this.store(task);
    return task;
  }

  async completeTask(listId: string, taskId: string): Promise<Task> {
    const existing = this.tasks.get(`${listId}:${taskId}`);
    if (!existing) throw new DomainError(`Task not found: ${taskId}`);
    const now = this.clock.now();
    const task: Task = { ...existing, status: 'completed', completedAt: now, updatedAt: now };
    this.store(task);
    return task;
  }

  async createList(title: string): Promise<TaskList> {
    const list: TaskList = {
      id: `list-${this.nextId++}`,
      accountId: this.accountId,
      title,
      isDefault: this.lists.length === 0,
    };
    this.lists.push(list);
    return list;
  }

  private requireList(listId: string): void {
    if (!this.lists.some((l) => l.id === listId)) throw new DomainError(`Task list not found: ${listId}`);
  }

  private store(task: Task): void {
    this.tasks.set(`${task.listId}:${task.id}`, task);
    this.log.record(task.listId, { kind: 'upsert', task });
  }
}
