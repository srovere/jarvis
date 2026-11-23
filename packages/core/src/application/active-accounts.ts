import { DomainError } from '../domain/errors';
import type { Account } from '../domain/model/account';
import type { AccountRepository } from '../domain/ports/repositories';

export async function activeAccounts(accounts: AccountRepository): Promise<Account[]> {
  return (await accounts.list()).filter((a) => a.status === 'active');
}

/** The account to act on: `accountId` (must be active) or else the first active account. */
export async function selectAccount(accounts: AccountRepository, accountId?: string): Promise<Account> {
  const active = await activeAccounts(accounts);
  if (accountId !== undefined) {
    const found = active.find((a) => a.id === accountId);
    if (!found) throw new DomainError(`Cuenta no activa: ${accountId}`);
    return found;
  }
  const first = active[0];
  if (!first) throw new DomainError('No hay cuentas activas');
  return first;
}
