import type { EmailAddress } from '../model/email-address';
import type { MailThreadSummary } from '../model/mail';
import type { PersonLinkLookup } from '../ports/repositories';

const EXCLUDED_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'SPAM', 'TRASH'];

export class PriorityRules {
  constructor(private readonly links: PersonLinkLookup) {}

  async rank(threads: MailThreadSummary[], own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> {
    const candidates = threads.filter((t) => !t.labels.some((l) => EXCLUDED_LABELS.includes(l)));
    const scored = await Promise.all(
      candidates.map(async (thread) => {
        const linked = !own.some((o) => o.equals(thread.lastFrom)) && (await this.links.isLinkedToAnyProject(thread.lastFrom));
        return { thread, linked };
      }),
    );
    return scored
      .filter(({ thread, linked }) => linked || this.isRelevant(thread))
      .sort((a, b) => Number(b.linked) - Number(a.linked) || b.thread.lastMessageAt.toMillis() - a.thread.lastMessageAt.toMillis())
      .slice(0, limit)
      .map(({ thread }) => thread);
  }

  private isRelevant(t: MailThreadSummary): boolean {
    if (t.labels.includes('IMPORTANT') || t.labels.includes('STARRED')) return true;
    const hasCategory = t.labels.some((l) => l.startsWith('CATEGORY_'));
    return t.unread && (t.labels.includes('CATEGORY_PERSONAL') || !hasCategory);
  }
}
