import { DateTime } from 'luxon';
import { DomainError } from '../../domain/errors';
import type { Account } from '../../domain/model/account';
import type { TaskList } from '../../domain/model/tasks';
import type { ProviderBundle } from '../../domain/ports/provider';
import type { AccountRepository, TaskRepository } from '../../domain/ports/repositories';
import { selectAccount } from '../active-accounts';
import type { AppSettings } from '../config';
import type { ProviderRegistry } from '../provider-registry';
import { toBriefingTasks, type BriefingTask } from '../views';

/** Creates a task (default list when none is given) and stores it. */
export class CreateTask {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tasks: TaskRepository,
    private readonly registry: ProviderRegistry,
    private readonly settings: AppSettings,
  ) {}

  async execute(q: { title: string; notes?: string; due?: string; listId?: string; accountId?: string }): Promise<BriefingTask> {
    const due = q.due === undefined ? undefined : this.parseDue(q.due);
    const account = await selectAccount(this.accounts, q.accountId);
    const bundle = await this.registry.forAccount(account);
    if (!bundle.tasks) throw new DomainError(`Account ${account.id} does not support tasks`);

    const lists = await this.knownLists(account, bundle, q.listId);
    const listId = q.listId ?? lists.find((l) => l.isDefault)?.id;
    if (!listId) throw new DomainError(`Account ${account.id} has no default task list`);
    const task = await bundle.tasks.createTask(listId, {
      title: q.title,
      ...(q.notes !== undefined ? { notes: q.notes } : {}),
      ...(due ? { due } : {}),
    });
    await this.tasks.applyChanges(account.id, listId, [{ kind: 'upsert', task }]);
    return toBriefingTasks([task], lists, this.settings.zone)[0]!;
  }

  private parseDue(due: string): DateTime {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(due) ? DateTime.fromISO(due, { zone: this.settings.zone }) : null;
    if (!dt?.isValid) throw new DomainError(`Invalid date: ${due}`);
    return dt.startOf('day');
  }

  /** Stored lists of the account; when they cannot resolve the wanted list (or a default), the provider's are stored first. */
  private async knownLists(account: Account, bundle: ProviderBundle, listId?: string): Promise<TaskList[]> {
    const stored = await this.tasks.lists([account.id]);
    if (listId !== undefined ? stored.some((l) => l.id === listId) : stored.some((l) => l.isDefault)) return stored;
    const fetched = await bundle.tasks!.listLists();
    await this.tasks.upsertLists(account.id, fetched);
    return this.tasks.lists([account.id]);
  }
}
