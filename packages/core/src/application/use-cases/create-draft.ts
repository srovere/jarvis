import { DomainError, InvalidEmailAddress } from '../../domain/errors';
import { EmailAddress } from '../../domain/model/email-address';
import type { AccountRepository } from '../../domain/ports/repositories';
import { selectAccount } from '../active-accounts';
import type { ProviderRegistry } from '../provider-registry';

/** Creates a Gmail-style draft; never sends anything. */
export class CreateDraft {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
  ) {}

  async execute(q: {
    to?: string[];
    cc?: string[];
    subject?: string;
    body: string;
    threadId?: string;
    accountId?: string;
  }): Promise<{ draftId: string; threadId?: string; to: string[]; subject: string; gmailUrl: string }> {
    if (!q.to?.length && !q.threadId) throw new DomainError('Either "to" or "thread_id" is required');
    const to = this.parse(q.to);
    const cc = this.parse(q.cc);
    const account = await selectAccount(this.accounts, q.accountId);
    const mail = (await this.registry.forAccount(account)).mail;
    if (!mail) throw new DomainError(`Account ${account.id} does not support email`);

    const ref = await mail.createDraft({
      ...(to.length ? { to } : {}),
      ...(cc.length ? { cc } : {}),
      ...(q.subject !== undefined ? { subject: q.subject } : {}),
      body: q.body,
      ...(q.threadId !== undefined ? { threadId: q.threadId } : {}),
    });
    return {
      draftId: ref.draftId,
      ...(ref.threadId !== undefined ? { threadId: ref.threadId } : {}),
      to: ref.to.map((a) => a.address),
      subject: ref.subject,
      gmailUrl: `https://mail.google.com/mail/#drafts?compose=${ref.draftId}`,
    };
  }

  private parse(raw: string[] | undefined): EmailAddress[] {
    return (raw ?? []).map((r) => {
      try {
        return EmailAddress.parse(r);
      } catch (e) {
        if (e instanceof InvalidEmailAddress) throw new DomainError(`Invalid address: ${r}`);
        throw e;
      }
    });
  }
}
