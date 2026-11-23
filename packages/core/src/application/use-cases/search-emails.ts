import type { MailMessage } from '../../domain/model/mail';
import type { AccountRepository } from '../../domain/ports/repositories';
import type { EmailCleaner } from '../../domain/services/email-cleaner';
import { activeAccounts } from '../active-accounts';
import type { AppSettings } from '../config';
import type { ProviderRegistry } from '../provider-registry';
import { toEmailResult, type EmailResult } from '../views';

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 20;

/** Live search on the provider of every active account; one result (the latest message) per matching thread. */
export class SearchEmails {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
    private readonly cleaner: EmailCleaner,
    private readonly settings: AppSettings,
  ) {}

  async execute(q: { query: string; maxResults?: number }): Promise<EmailResult[]> {
    const maxResults = Math.min(MAX_RESULTS, Math.max(1, Math.trunc(q.maxResults ?? DEFAULT_MAX_RESULTS)));
    const latest: MailMessage[] = [];
    for (const account of await activeAccounts(this.accounts)) {
      const mail = (await this.registry.forAccount(account)).mail;
      if (!mail) continue;
      for (const summary of await mail.listThreads({ query: q.query, maxResults })) {
        const thread = await mail.getThread(summary.id);
        const last = thread.messages.reduce<MailMessage | undefined>((a, m) => (!a || m.date > a.date ? m : a), undefined);
        if (last) latest.push(last);
      }
    }
    return latest
      .sort((a, b) => b.date.toMillis() - a.date.toMillis())
      .slice(0, maxResults)
      .map((m) => toEmailResult(m, this.cleaner, this.settings.zone));
  }
}
