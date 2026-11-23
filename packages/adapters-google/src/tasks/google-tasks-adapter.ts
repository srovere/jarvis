import { DomainError } from '@jarvis/core';
import type { SyncResult, Task, TaskChange, TaskList, TaskReader, TaskWriter } from '@jarvis/core';
import type { DateTime } from 'luxon';
import type { tasks_v1 } from 'googleapis';
import { callGoogle } from '../google-errors';
import { TasksMapper } from './tasks-mapper';

const PAGE_SIZE = 100;
const EPOCH = '1970-01-01T00:00:00.000Z';

/** Google Tasks como `TaskReader` y `TaskWriter`. */
export class GoogleTasksAdapter implements TaskReader, TaskWriter {
  private readonly mapper: TasksMapper;

  constructor(
    private readonly tasks: tasks_v1.Tasks,
    private readonly accountId: string,
  ) {
    this.mapper = new TasksMapper(accountId);
  }

  /** La primera lista devuelta es la que Google crea por defecto ("My Tasks"). */
  async listLists(): Promise<TaskList[]> {
    const raw: tasks_v1.Schema$TaskList[] = [];
    let pageToken: string | undefined;
    do {
      const token = pageToken;
      const page = await this.call(() => this.tasks.tasklists.list({ maxResults: PAGE_SIZE, pageToken: token }));
      raw.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return raw.flatMap((l, i) => {
      const mapped = this.mapper.toList(l, i === 0);
      return mapped ? [mapped] : [];
    });
  }

  /**
   * Cursor sin pérdidas: `<iso>|<id1,id2,...>` con el `updated` máximo visto y los ids de las tareas
   * con ese instante. `updatedMin` es inclusivo (resolución de ms), así que sólo se omiten las ya vistas
   * en ese instante; una tarea nueva con el mismo `updated` se entrega igual.
   */
  async sync(listId: string, cursor: string | null): Promise<SyncResult<TaskChange>> {
    const parsed = this.parseCursor(cursor);
    const changes: TaskChange[] = [];
    let maxMs = parsed.ms;
    let maxIso = parsed.iso;
    let atMax = new Set(parsed.seen);
    let pageToken: string | undefined;
    do {
      const token = pageToken;
      const page = await this.call(() =>
        this.tasks.tasks.list({
          tasklist: listId,
          showCompleted: true,
          showHidden: true,
          showDeleted: true,
          maxResults: PAGE_SIZE,
          pageToken: token,
          ...(cursor !== null && { updatedMin: parsed.iso }),
        }),
      );
      for (const t of page.items ?? []) {
        const task = this.mapper.toTask(t, listId);
        if (!task) continue;
        const ms = task.updatedAt.toMillis();
        if (cursor !== null && (ms < parsed.ms || (ms === parsed.ms && parsed.seen.has(task.id)))) continue;
        if (ms > maxMs) {
          maxMs = ms;
          maxIso = task.updatedAt.toUTC().toISO()!;
          atMax = new Set();
        }
        if (ms === maxMs) atMax.add(task.id);
        changes.push(task.deleted ? { kind: 'delete', taskId: task.id } : { kind: 'upsert', task });
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return { changes, nextCursor: `${maxIso}|${[...atMax].join(',')}`, fullResync: cursor === null };
  }

  /** Acepta también el formato antiguo (ISO sin `|`) como conjunto de ids vacío. */
  private parseCursor(cursor: string | null): { iso: string; ms: number; seen: Set<string> } {
    const [iso = EPOCH, ids = ''] = (cursor ?? EPOCH).split('|');
    return { iso, ms: Date.parse(iso), seen: new Set(ids.split(',').filter(Boolean)) };
  }

  async createTask(listId: string, t: { title: string; notes?: string; due?: DateTime }): Promise<Task> {
    const created = await this.call(() =>
      this.tasks.tasks.insert({
        tasklist: listId,
        requestBody: {
          title: t.title,
          ...(t.notes !== undefined && { notes: t.notes }),
          ...(t.due && { due: `${t.due.toISODate()!}T00:00:00.000Z` }),
        },
      }),
    );
    return this.mapTask(created, listId);
  }

  async completeTask(listId: string, taskId: string): Promise<Task> {
    const done = await this.call(() =>
      this.tasks.tasks.patch({ tasklist: listId, task: taskId, requestBody: { status: 'completed' } }),
    );
    return this.mapTask(done, listId);
  }

  async createList(title: string): Promise<TaskList> {
    const created = await this.call(() => this.tasks.tasklists.insert({ requestBody: { title } }));
    const list = this.mapper.toList(created, false);
    if (!list) throw new DomainError('Tasks returned a list without id');
    return list;
  }

  private mapTask(raw: tasks_v1.Schema$Task, listId: string): Task {
    const task = this.mapper.toTask(raw, listId);
    if (!task) throw new DomainError('Tasks returned a task without id');
    return task;
  }

  private call<T>(request: () => Promise<{ data: T }>): Promise<T> {
    return callGoogle(this.accountId, request);
  }
}
