import { DomainError } from '../../domain/errors';
import type { Account } from '../../domain/model/account';
import type { MailThread } from '../../domain/model/mail';
import type { AccountRepository } from '../../domain/ports/repositories';
import type { EmailCleaner } from '../../domain/services/email-cleaner';
import { activeAccounts } from '../active-accounts';
import type { AppSettings } from '../config';
import type { ProviderRegistry } from '../provider-registry';
import { toEmailResult, type EmailResult } from '../views';

export interface ThreadView {
  threadId: string;
  subject: string;
  messages: EmailResult[];
}

/** Reads a thread live from the provider: from `accountId`, or from the first active account that has it. */
export class ReadThread {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
    private readonly cleaner: EmailCleaner,
    private readonly settings: AppSettings,
  ) {}

  async execute(q: { accountId?: string; threadId: string }): Promise<ThreadView> {
    const thread = q.accountId
      ? await this.fetch(await this.accounts.get(q.accountId), q.threadId)
      : await this.findInActiveAccounts(q.threadId);
    return {
      threadId: thread.id,
      subject: thread.subject,
      messages: [...thread.messages]
        .sort((a, b) => a.date.toMillis() - b.date.toMillis())
        .map((m) => toEmailResult(m, this.cleaner, this.settings.zone)),
    };
  }

  private async findInActiveAccounts(threadId: string): Promise<MailThread> {
    const notFound = `Thread not found: ${threadId}`;
    for (const account of await activeAccounts(this.accounts)) {
      try {
        return await this.fetch(account, threadId);
      } catch (e) {
        if (!(e instanceof DomainError && e.message === notFound)) throw e;
      }
    }
    throw new DomainError(notFound);
  }

  private async fetch(account: Account, threadId: string): Promise<MailThread> {
    const mail = (await this.registry.forAccount(account)).mail;
    if (!mail) throw new DomainError(`Thread not found: ${threadId}`);
    return mail.getThread(threadId);
  }
}
