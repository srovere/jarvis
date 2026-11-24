import type { Task } from '../../domain/model/tasks';
import type { AccountRepository, TaskRepository } from '../../domain/ports/repositories';
import { activeAccounts } from '../active-accounts';
import type { AppSettings, SettingsProvider } from '../config';
import { toBriefingTasks, type BriefingTask } from '../views';

export type TaskStatusFilter = 'open' | 'completed' | 'all';

/** Stored, non-deleted tasks of the active accounts, filtered by status (default `open`). */
export class ListTasks {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tasks: TaskRepository,
    private readonly settings: SettingsProvider,
  ) {}

  async execute(q: { status?: TaskStatusFilter }): Promise<BriefingTask[]> {
    const { zone } = await this.settings.current();
    const status = q.status ?? 'open';
    const accountIds = (await activeAccounts(this.accounts)).map((a) => a.id);
    const found: Task[] = [
      ...(status !== 'completed' ? await this.tasks.open({ accountIds }) : []),
      ...(status !== 'open' ? await this.tasks.completed({ accountIds }) : []),
    ];
    return toBriefingTasks(found, await this.tasks.lists(accountIds), zone);
  }
}
