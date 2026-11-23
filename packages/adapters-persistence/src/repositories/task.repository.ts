import type { Task, TaskChange, TaskList, TaskRepository } from '@jarvis/core';
import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { DateTime } from 'luxon';
import type { Db } from '../db';
import { fromDate, fromDateOrUndefined, toDate, toDateOrNull } from '../mappers';
import { taskLists, tasks } from '../schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Db) {}

  async upsertLists(accountId: string, lists: TaskList[]): Promise<void> {
    for (const l of lists) {
      const values = { title: l.title, isDefault: l.isDefault };
      await this.db
        .insert(taskLists)
        .values({ accountId, externalId: l.id, ...values })
        .onConflictDoUpdate({
          target: [taskLists.accountId, taskLists.externalId],
          set: { ...values, updatedAt: sql`now()` },
        });
    }
  }

  async applyChanges(accountId: string, listId: string, changes: TaskChange[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const internalListId = await this.ensureList(tx, accountId, listId);
      for (const c of changes) {
        if (c.kind === 'upsert') await this.upsert(tx, accountId, internalListId, c.task);
        else
          await tx
            .delete(tasks)
            .where(and(eq(tasks.accountId, accountId), eq(tasks.listId, internalListId), eq(tasks.externalId, c.taskId)));
      }
    });
  }

  /** Open, non-deleted tasks; with `dueBefore`, only tasks that have a due date strictly before it. */
  async open(q: { accountIds: string[]; dueBefore?: DateTime }): Promise<Task[]> {
    if (q.accountIds.length === 0) return [];
    const rows = await this.db
      .select({ task: tasks, listExternalId: taskLists.externalId })
      .from(tasks)
      .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
      .where(
        and(
          inArray(tasks.accountId, q.accountIds),
          eq(tasks.status, 'open'),
          eq(tasks.deleted, false),
          q.dueBefore ? and(isNotNull(tasks.dueAt), lt(tasks.dueAt, toDate(q.dueBefore))) : undefined,
        ),
      )
      .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt));
    return rows.map((r) => toTask(r.task, r.listExternalId));
  }

  private async upsert(tx: Tx, accountId: string, listId: string, t: Task): Promise<void> {
    const values = {
      listId,
      title: t.title,
      notes: t.notes ?? null,
      status: t.status,
      dueAt: toDateOrNull(t.due),
      createdAtExt: toDateOrNull(t.createdAt),
      updatedAtExt: toDate(t.updatedAt),
      completedAt: toDateOrNull(t.completedAt),
      deleted: t.deleted,
      raw: t.raw ?? null,
    };
    await tx
      .insert(tasks)
      .values({ accountId, externalId: t.id, ...values })
      .onConflictDoUpdate({
        target: [tasks.accountId, tasks.listId, tasks.externalId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }

  /** Lists are only known by their external id here; a placeholder row is created until `upsertLists` fills it in. */
  private async ensureList(tx: Tx, accountId: string, externalId: string): Promise<string> {
    await tx
      .insert(taskLists)
      .values({ accountId, externalId, title: externalId })
      .onConflictDoNothing({ target: [taskLists.accountId, taskLists.externalId] });
    const [row] = await tx
      .select({ id: taskLists.id })
      .from(taskLists)
      .where(and(eq(taskLists.accountId, accountId), eq(taskLists.externalId, externalId)));
    return row!.id;
  }
}

function toTask(row: typeof tasks.$inferSelect, listExternalId: string): Task {
  const due = fromDateOrUndefined(row.dueAt);
  const createdAt = fromDateOrUndefined(row.createdAtExt);
  const completedAt = fromDateOrUndefined(row.completedAt);
  return {
    id: row.externalId,
    accountId: row.accountId,
    listId: listExternalId,
    title: row.title,
    ...(row.notes != null ? { notes: row.notes } : {}),
    status: row.status,
    ...(due ? { due } : {}),
    ...(createdAt ? { createdAt } : {}),
    updatedAt: fromDate(row.updatedAtExt),
    ...(completedAt ? { completedAt } : {}),
    deleted: row.deleted,
    ...(row.raw != null ? { raw: row.raw } : {}),
  };
}
