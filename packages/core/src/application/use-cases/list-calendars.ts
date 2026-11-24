import { CALENDAR_LIST_SCOPE, type Account } from '../../domain/model/account';
import type { AccountRepository } from '../../domain/ports/repositories';
import { activeAccounts, selectAccount } from '../active-accounts';
import type { ProviderRegistry } from '../provider-registry';

export interface CalendarView {
  accountId: string;
  id: string;
  title: string;
  primary: boolean;
  /** Whether the calendar's events block time (is in the account's busy calendars). */
  busy: boolean;
  /** Present (true) when the account lacks the calendar-list scope, so only `primary` is known. */
  missingScope?: true;
}

/**
 * Live calendars of one active account (or of all of them). An account without the calendar-list scope yields only
 * `primary`: that is decided from the stored missing scopes, not by making a call that would fail.
 */
export class ListCalendars {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
  ) {}

  async execute(q: { accountId?: string }): Promise<CalendarView[]> {
    const selected = q.accountId !== undefined ? [await selectAccount(this.accounts, q.accountId)] : await activeAccounts(this.accounts);
    const out: CalendarView[] = [];
    for (const account of selected) out.push(...(await this.forAccount(account)));
    return out;
  }

  private async forAccount(account: Account): Promise<CalendarView[]> {
    const busy = (id: string) => account.busyCalendars.includes(id);
    if (account.missingScopes.includes(CALENDAR_LIST_SCOPE)) {
      return [{ accountId: account.id, id: 'primary', title: 'primary', primary: true, busy: busy('primary'), missingScope: true }];
    }
    const calendar = (await this.registry.forAccount(account)).calendar;
    if (!calendar) return [];
    return (await calendar.listCalendars()).map((c) => ({ accountId: account.id, ...c, busy: busy(c.id) }));
  }
}
