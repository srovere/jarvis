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

  /** Every active account, or only `accountId` (which must be active). */
  async run(accountId?: string): Promise<AccountSyncOutcome[]> {
    const targets: Account[] =
      accountId === undefined ? await activeAccounts(this.accounts) : [await selectAccount(this.accounts, accountId)];
    const outcomes: AccountSyncOutcome[] = [];
    for (const { id } of targets) {
      try {
        outcomes.push({ accountId: id, result: await this.syncer.execute(id) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.log(JSON.stringify({ level: 'error', msg: 'account sync failed', accountId: id, error }));
        outcomes.push({ accountId: id, error });
      }
    }
    return outcomes;
  }
}
