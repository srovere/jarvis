import { DomainError } from '../../domain/errors';
import type { Account, ProviderKind } from '../../domain/model/account';
import type { AccountConnector, AuthorizationStart } from '../../domain/ports/account-connector';
import type { AccountRepository } from '../../domain/ports/repositories';
import { deriveAccountId } from '../account-id';
import type { ProviderRegistry } from '../provider-registry';

export interface CompleteConnectOptions {
  /** Use this id instead of deriving one (CLI `--account`); fails when it belongs to another email. */
  readonly accountId?: string;
  /** Default `wizard`; an account that already exists keeps its original origin. */
  readonly createdVia?: Account['createdVia'];
}

/**
 * Connects (or reconnects) an account through a provider's browser authorization. Nothing is stored until the
 * provider confirmed the authorization; credentials are saved before the account becomes `active`.
 */
export class ConnectAccount {
  constructor(
    private readonly connectors: AccountConnector[],
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
  ) {}

  /** The caller keeps `state` and `verifier` server-side until the callback arrives. */
  async begin(kind: ProviderKind, redirectUri: string): Promise<AuthorizationStart> {
    return this.connector(kind).beginAuthorization({ redirectUri });
  }

  async complete(
    kind: ProviderKind,
    input: { code: string; redirectUri: string; verifier: string },
    options: CompleteConnectOptions = {},
  ): Promise<Account> {
    const connector = this.connector(kind);
    const { email, credentials, grantedScopes } = await connector.completeAuthorization(input);
    const existing = await this.accounts.findByEmail(email);
    const id = existing?.id ?? (await this.newId(email, options.accountId));
    if (existing && options.accountId !== undefined && options.accountId !== existing.id) {
      throw new DomainError(`${email.address} is already connected as account "${existing.id}", not "${options.accountId}"`);
    }
    await connector.saveCredentials(id, credentials);
    const account: Account = {
      id,
      provider: kind,
      email,
      ...(existing?.displayName !== undefined ? { displayName: existing.displayName } : {}),
      status: 'active',
      busyCalendars: existing?.busyCalendars ?? ['primary'],
      missingScopes: connector.missingScopes(grantedScopes),
      createdVia: existing?.createdVia ?? options.createdVia ?? 'wizard',
    };
    try {
      await this.accounts.upsert(account);
    } catch (error) {
      if (!existing) await connector.deleteCredentials(id).catch(() => undefined);
      throw error;
    }
    this.registry.invalidate(id);
    return account;
  }

  private async newId(email: Account['email'], requested: string | undefined): Promise<string> {
    const taken = new Set((await this.accounts.list()).map((a) => a.id));
    if (requested === undefined) return deriveAccountId(email, taken);
    if (taken.has(requested)) throw new DomainError(`Account id "${requested}" is already used by another email`);
    return requested;
  }

  private connector(kind: ProviderKind): AccountConnector {
    const connector = this.connectors.find((c) => c.kind === kind);
    if (!connector) throw new DomainError(`No account connector for provider "${kind}"`);
    return connector;
  }
}
