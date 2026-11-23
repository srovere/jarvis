import type { tasks_v1 } from 'googleapis';
import { vi } from 'vitest';

type Task = tasks_v1.Schema$Task;

export interface FakeTasksOptions {
  /** Reloj; por defecto `Date.now`. El fake lo hace estrictamente creciente. */
  now?: () => number;
  /** Tamaño de página (para ejercitar la paginación). */
  pageSize?: number;
}

interface ListParams {
  tasklist: string;
  showCompleted?: boolean;
  showHidden?: boolean;
  showDeleted?: boolean;
  updatedMin?: string;
  pageToken?: string;
}

/** Google Tasks en memoria: implementa el subconjunto de `tasks_v1.Tasks` que usa el adaptador. */
export class FakeTasks {
  readonly calls = {
    tasksList: vi.fn(),
    tasksInsert: vi.fn(),
    tasksPatch: vi.fn(),
    tasklistsInsert: vi.fn(),
  };

  private readonly lists: tasks_v1.Schema$TaskList[] = [];
  private readonly tasks = new Map<string, Map<string, Task>>();
  private readonly now: () => number;
  private readonly pageSize: number;
  private last = 0;
  private nextId = 1;

  private readonly client = {
    tasklists: {
      list: async (p: { pageToken?: string }) => ({ data: this.page(this.lists, p.pageToken) }),
      insert: async (p: { requestBody: tasks_v1.Schema$TaskList }) => this.listsInsert(p),
    },
    tasks: {
      list: async (p: ListParams) => this.tasksList(p),
      insert: async (p: { tasklist: string; requestBody: Task }) => this.tasksInsert(p),
      patch: async (p: { tasklist: string; task: string; requestBody: Task }) => this.tasksPatch(p),
    },
  };

  /** Google crea una lista por defecto al abrir la cuenta. */
  constructor(opts: FakeTasksOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.pageSize = opts.pageSize ?? 100;
    this.addList('My Tasks');
  }

  asTasks(): tasks_v1.Tasks {
    return this.client as unknown as tasks_v1.Tasks;
  }

  // --- siembra / mutaciones ---------------------------------------------------------------------

  addList(title: string): string {
    const id = `list${this.nextId++}`;
    this.lists.push({ id, title });
    this.tasks.set(id, new Map());
    return id;
  }

  seed(listId: string, task: Task): string {
    const id = task.id ?? `task${this.nextId++}`;
    this.tasks.get(listId)?.set(id, { status: 'needsAction', ...task, id, updated: task.updated ?? this.stamp() });
    return id;
  }

  markDeleted(listId: string, id: string): void {
    const t = this.tasks.get(listId)?.get(id);
    if (t) this.tasks.get(listId)!.set(id, { ...t, deleted: true, updated: this.stamp() });
  }

  // --- API ----------------------------------------------------------------------------------------

  private listsInsert(p: { requestBody: tasks_v1.Schema$TaskList }) {
    this.calls.tasklistsInsert(p);
    const id = this.addList(p.requestBody.title ?? '');
    return { data: this.lists.find((l) => l.id === id)! };
  }

  private tasksList(p: ListParams) {
    this.calls.tasksList(p);
    const all = [...(this.tasks.get(p.tasklist)?.values() ?? [])];
    const min = p.updatedMin ? Date.parse(p.updatedMin) : undefined;
    const rows = all.filter((t) => {
      if (t.deleted && !p.showDeleted) return false;
      if (t.hidden && !p.showHidden) return false;
      if (t.status === 'completed' && p.showCompleted === false) return false;
      return min === undefined || Date.parse(t.updated!) >= min;
    });
    rows.sort((a, b) => Date.parse(a.updated!) - Date.parse(b.updated!));
    return { data: this.page(rows, p.pageToken) };
  }

  private tasksInsert(p: { tasklist: string; requestBody: Task }) {
    this.calls.tasksInsert(p);
    const id = this.seed(p.tasklist, { ...p.requestBody, id: undefined });
    return { data: this.tasks.get(p.tasklist)!.get(id)! };
  }

  private tasksPatch(p: { tasklist: string; task: string; requestBody: Task }) {
    this.calls.tasksPatch(p);
    const list = this.tasks.get(p.tasklist);
    const cur = list?.get(p.task);
    if (!list || !cur) throw Object.assign(new Error('HTTP 404'), { code: 404 });
    const updated = this.stamp();
    const next: Task = { ...cur, ...p.requestBody, updated };
    if (p.requestBody.status === 'completed') next.completed = updated;
    list.set(p.task, next);
    return { data: next };
  }

  /** RFC3339 estrictamente creciente. */
  private stamp(): string {
    this.last = Math.max(this.now(), this.last + 1);
    return new Date(this.last).toISOString();
  }

  private page<T>(items: T[], pageToken: string | undefined): { items: T[]; nextPageToken?: string } {
    const from = pageToken ? Number(pageToken) : 0;
    const to = from + this.pageSize;
    return { items: items.slice(from, to), ...(to < items.length && { nextPageToken: String(to) }) };
  }
}
