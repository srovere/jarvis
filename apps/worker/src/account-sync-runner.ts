import { LOG_SINK, type LogSink } from '@jarvis/composition';
import {
  activeAccounts,
  selectAccount,
  TOKENS,
  type Account,
  type AccountRepository,
  type SyncAccount,
  type SyncAccountResult,
} from '@jarvis/core';
import { Inject, Injectable } from '@nestjs/common';

export type AccountSyncer = Pick<SyncAccount, 'execute'>;

export interface AccountSyncOutcome {
  accountId: string;
  /** The account's status after the run; `needs_reauth` accounts are reported but not synced. */
  status: Account['status'];
  result?: SyncAccountResult;
  /** Message of the error that aborted this account's sync. */
  error?: string;
}

/** Runs `SyncAccount` serially over active accounts; one account's failure does not stop the others. */
@Injectable()
export class AccountSyncRunner {
  constructor(
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(TOKENS.SyncAccount) private readonly syncer: AccountSyncer,
    @Inject(LOG_SINK) private readonly log: LogSink,
  ) {}

  /**
   * Every active account, or only `accountId` (which must be active). Without `accountId`, accounts that
   * need re-authorization are listed too (skipped) so callers can see and report them.
   */
  async run(accountId?: string): Promise<AccountSyncOutcome[]> {
    const outcomes: AccountSyncOutcome[] = [];
    if (accountId === undefined) {
      for (const a of await this.accounts.list()) {
        if (a.status === 'needs_reauth') outcomes.push({ accountId: a.id, status: a.status });
      }
    }
    const targets: Account[] =
      accountId === undefined ? await activeAccounts(this.accounts) : [await selectAccount(this.accounts, accountId)];
    const synced: AccountSyncOutcome[] = [];
    for (const { id } of targets) {
      try {
        const result = await this.syncer.execute(id);
        synced.push({ accountId: id, status: result.status, result });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.log(JSON.stringify({ level: 'error', msg: 'account sync failed', accountId: id, error }));
        synced.push({ accountId: id, status: 'active', error });
      }
    }
    return [...synced, ...outcomes];
  }
}
