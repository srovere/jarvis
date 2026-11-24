import { DomainError } from '../../domain/errors';
import type { AccountRepository, TaskRepository } from '../../domain/ports/repositories';
import { selectAccount } from '../active-accounts';
import type { AppSettings, SettingsProvider } from '../config';
import type { ProviderRegistry } from '../provider-registry';
import { toBriefingTasks, type BriefingTask } from '../views';

/** Marks a stored task as completed at the provider and stores the result. */
export class CompleteTask {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tasks: TaskRepository,
    private readonly registry: ProviderRegistry,
    private readonly settings: SettingsProvider,
  ) {}

  async execute(q: { taskId: string; accountId?: string }): Promise<BriefingTask> {
    const { zone } = await this.settings.current();
    const account = await selectAccount(this.accounts, q.accountId);
    const existing = await this.tasks.get(account.id, q.taskId);
    if (!existing || existing.deleted) throw new DomainError(`Task not found: ${q.taskId}`);
    const writer = (await this.registry.forAccount(account)).tasks;
    if (!writer) throw new DomainError(`Account ${account.id} does not support tasks`);

    const done = await writer.completeTask(existing.listId, existing.id);
    await this.tasks.applyChanges(account.id, existing.listId, [{ kind: 'upsert', task: done }]);
    return toBriefingTasks([done], await this.tasks.lists([account.id]), zone)[0]!;
  }
}
