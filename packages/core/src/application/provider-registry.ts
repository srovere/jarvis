import { DomainError } from '../domain/errors';
import type { Account, ProviderKind } from '../domain/model/account';
import type { ProviderBundle, ProviderFactory } from '../domain/ports/provider';

export class ProviderRegistry {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();
  private readonly bundles = new Map<string, Promise<ProviderBundle>>();

  register(f: ProviderFactory): void {
    if (this.factories.has(f.kind)) throw new DomainError(`Provider already registered for kind "${f.kind}"`);
    this.factories.set(f.kind, f);
  }

  forAccount(a: Account): Promise<ProviderBundle> {
    const cached = this.bundles.get(a.id);
    if (cached) return cached;
    const factory = this.factories.get(a.provider);
    if (!factory) return Promise.reject(new DomainError(`No provider registered for kind "${a.provider}"`));
    const created = factory.create(a);
    this.bundles.set(a.id, created);
    created.catch(() => this.bundles.delete(a.id));
    return created;
  }
}
