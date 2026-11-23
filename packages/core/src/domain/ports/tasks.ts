import type { DateTime } from 'luxon';
import type { Task, TaskList } from '../model/tasks';
import type { SyncResult } from './mail';

export type TaskChange = { kind: 'upsert'; task: Task } | { kind: 'delete'; taskId: string };

export interface TaskReader {
  listLists(): Promise<TaskList[]>;
  sync(listId: string, cursor: string | null): Promise<SyncResult<TaskChange>>;
}

export interface TaskWriter {
  createTask(listId: string, t: { title: string; notes?: string; due?: DateTime }): Promise<Task>;
  completeTask(listId: string, taskId: string): Promise<Task>;
  createList(title: string): Promise<TaskList>;
}
