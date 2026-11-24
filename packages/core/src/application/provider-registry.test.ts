import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../domain/errors';
import { EmailAddress } from '../domain/model/email-address';
import type { Account } from '../domain/model/account';
import type { ProviderBundle, ProviderFactory } from '../domain/ports/provider';
import { ProviderRegistry } from './provider-registry';

const account = (id: string, provider = 'google'): Account => ({
  id,
  provider,
  email: EmailAddress.parse('me@x.com'),
  status: 'active',
});

const bundle = (): ProviderBundle => ({
  identity: { ownAddresses: async () => [] },
  capabilities: { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true },
});

describe('ProviderRegistry', () => {
  it('throws for an unknown kind', async () => {
    await expect(new ProviderRegistry().forAccount(account('1', 'imap'))).rejects.toThrow(
      'No provider registered for kind "imap"',
    );
  });

  it('caches the bundle per account id', async () => {
    const create = vi.fn(async () => bundle());
    const factory: ProviderFactory = { kind: 'google', create };
    const reg = new ProviderRegistry();
    reg.register(factory);
    const a = await reg.forAccount(account('1'));
    const b = await reg.forAccount(account('1'));
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    await reg.forAccount(account('2'));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops the cached bundle so the next lookup builds a fresh one', async () => {
    const create = vi.fn(async () => bundle());
    const reg = new ProviderRegistry();
    reg.register({ kind: 'google', create });
    const first = await reg.forAccount(account('1'));
    reg.invalidate('1');
    const second = await reg.forAccount(account('1'));
    expect(second).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate registration of a kind', () => {
    const reg = new ProviderRegistry();
    const f: ProviderFactory = { kind: 'google', create: async () => bundle() };
    reg.register(f);
    expect(() => reg.register(f)).toThrow(new DomainError('Provider already registered for kind "google"'));
  });

  it('does not cache failed creations', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(bundle());
    const reg = new ProviderRegistry();
    reg.register({ kind: 'google', create });
    await expect(reg.forAccount(account('1'))).rejects.toThrow('boom');
    await expect(reg.forAccount(account('1'))).resolves.toBeDefined();
  });

  it('rebuilds the cached bundle when the factory fingerprint changed, and reuses it otherwise', async () => {
    const create = vi.fn(async () => bundle());
    let fp = 'v1';
    const reg = new ProviderRegistry();
    reg.register({ kind: 'google', create, fingerprint: async () => fp });
    const first = await reg.forAccount(account('1'));
    expect(await reg.forAccount(account('1'))).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    fp = 'v2';
    const second = await reg.forAccount(account('1'));
    expect(second).not.toBe(first);
    expect(await reg.forAccount(account('1'))).toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
