import { DomainError } from '../../domain/errors';
import type { AccountConnector } from '../../domain/ports/account-connector';
import type { AccountRepository } from '../../domain/ports/repositories';
import type { ProviderRegistry } from '../provider-registry';

/** Disables an account and deletes its credentials; synced data is kept unless `deleteData` is set. */
export class RemoveAccount {
  constructor(
    private readonly connectors: AccountConnector[],
    private readonly accounts: AccountRepository,
    private readonly registry: ProviderRegistry,
  ) {}

  async execute(id: string, options: { deleteData: boolean }): Promise<void> {
    const account = await this.accounts.get(id);
    const connector = this.connectors.find((c) => c.kind === account.provider);
    if (!connector) throw new DomainError(`No account connector for provider "${account.provider}"`);
    try {
      await this.accounts.setStatus(id, 'disabled');
      await connector.deleteCredentials(id);
      if (options.deleteData) await this.accounts.deleteData(id);
    } finally {
      this.registry.invalidate(id);
    }
  }
}
