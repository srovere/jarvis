import { DomainError } from '../domain/errors';
import type { Account, ProviderKind } from '../domain/model/account';
import type { ProviderBundle, ProviderFactory } from '../domain/ports/provider';

export class ProviderRegistry {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();
  private readonly bundles = new Map<string, { fingerprint: string | undefined; bundle: Promise<ProviderBundle> }>();

  register(f: ProviderFactory): void {
    if (this.factories.has(f.kind)) throw new DomainError(`Provider already registered for kind "${f.kind}"`);
    this.factories.set(f.kind, f);
  }

  async forAccount(a: Account): Promise<ProviderBundle> {
    const factory = this.factories.get(a.provider);
    if (!factory) throw new DomainError(`No provider registered for kind "${a.provider}"`);
    const fingerprint = factory.fingerprint ? await factory.fingerprint(a) : undefined;
    const cached = this.bundles.get(a.id);
    if (cached && cached.fingerprint === fingerprint) return cached.bundle;
    const entry = { fingerprint, bundle: factory.create(a) };
    this.bundles.set(a.id, entry);
    entry.bundle.catch(() => {
      if (this.bundles.get(a.id) === entry) this.bundles.delete(a.id);
    });
    return entry.bundle;
  }

  /** Drops the cached bundle so the next lookup rebuilds it (e.g. re-reading a re-authorized token). */
  invalidate(accountId: string): void {
    this.bundles.delete(accountId);
  }
}
