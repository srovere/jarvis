import type { AccountRepository, TaskRepository } from '../../domain/ports/repositories';
import { activeAccounts } from '../active-accounts';

export interface TaskListView {
  accountId: string;
  id: string;
  title: string;
}

/** The synced task lists of the active accounts. */
export class ListTaskLists {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tasks: TaskRepository,
  ) {}

  async execute(): Promise<TaskListView[]> {
    const ids = (await activeAccounts(this.accounts)).map((a) => a.id);
    return (await this.tasks.lists(ids)).map((l) => ({ accountId: l.accountId, id: l.id, title: l.title }));
  }
}
