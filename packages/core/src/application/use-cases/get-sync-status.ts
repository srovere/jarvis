import type { Account } from '../../domain/model/account';
import type { AccountRepository, SyncStateRepository } from '../../domain/ports/repositories';

export interface AccountSyncStatus {
  accountId: string;
  email: string;
  status: Account['status'];
  /** ISO 8601 (UTC) time of the latest sync of any resource, or null when it never synced. */
  lastSyncAt: string | null;
  missingScopes: string[];
}

/**
 * Sync state of every account the user can still act on: active ones and those needing re-authorization (the
 * dashboard shows the latter). Disabled accounts are left out, as phase 1 never reads them.
 */
export class GetSyncStatus {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly syncState: SyncStateRepository,
  ) {}

  async execute(): Promise<AccountSyncStatus[]> {
    const out: AccountSyncStatus[] = [];
    for (const a of (await this.accounts.list()).filter((x) => x.status !== 'disabled')) {
      const last = await this.syncState.latestRunAt(a.id);
      out.push({
        accountId: a.id,
        email: a.email.address,
        status: a.status,
        lastSyncAt: last ? last.toUTC().toISO() : null,
        missingScopes: a.missingScopes,
      });
    }
    return out;
  }
}
