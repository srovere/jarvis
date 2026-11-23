import type { Account } from '../domain/model/account';
import type { AccountRepository } from '../domain/ports/repositories';

export async function activeAccounts(accounts: AccountRepository): Promise<Account[]> {
  return (await accounts.list()).filter((a) => a.status === 'active');
}
