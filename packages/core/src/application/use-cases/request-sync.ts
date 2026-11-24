import type { AccountRepository } from '../../domain/ports/repositories';
import type { SyncRequests } from '../../domain/ports/sync-requests';
import { activeAccounts, selectAccount } from '../active-accounts';

/** Asks for an immediate sync of one active account or of all of them; the worker runs it on its next poll. */
export class RequestSync {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly requests: SyncRequests,
  ) {}

  /** Returns the ids requested. */
  async execute(q: { accountId?: string }): Promise<string[]> {
    const ids =
      q.accountId !== undefined
        ? [(await selectAccount(this.accounts, q.accountId)).id]
        : (await activeAccounts(this.accounts)).map((a) => a.id);
    if (ids.length > 0) await this.requests.request(ids);
    return ids;
  }
}
