import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../domain/errors';
import type { Account } from '../../domain/model/account';
import { EmailAddress } from '../../domain/model/email-address';
import type { AccountConnector } from '../../domain/ports/account-connector';
import { InMemoryRepositories } from '../../testing/in-memory-repositories';
import { ProviderRegistry } from '../provider-registry';
import { ConnectAccount } from './connect-account';
import { RemoveAccount } from './remove-account';
import { SetBusyCalendars } from './set-busy-calendars';

const SCOPES = ['a', 'b'];

class FakeConnector implements AccountConnector {
  readonly kind = 'google';
  email = 'ana@example.com';
  granted = ['a', 'b'];
  fail: Error | undefined;
  readonly saved = new Map<string, unknown>();
  readonly deleted: string[] = [];
  async beginAuthorization() {
    return { url: 'https://auth', state: 's', verifier: 'v' };
  }
  async completeAuthorization() {
    if (this.fail) throw this.fail;
    return { email: EmailAddress.parse(this.email), credentials: { t: 1 }, grantedScopes: this.granted };
  }
  async saveCredentials(id: string, c: unknown) {
    this.saved.set(id, c);
  }
  async deleteCredentials(id: string) {
    this.saved.delete(id);
    this.deleted.push(id);
  }
  missingScopes(granted: string[]) {
    return SCOPES.filter((s) => !granted.includes(s));
  }
}

function setup() {
  const repos = new InMemoryRepositories();
  const connector = new FakeConnector();
  const registry = new ProviderRegistry();
  const invalidate = vi.spyOn(registry, 'invalidate');
  const connect = new ConnectAccount([connector], repos.accounts, registry);
  const remove = new RemoveAccount([connector], repos.accounts, registry);
  return { repos, connector, registry, invalidate, connect, remove };
}
const input = { code: 'c', redirectUri: 'http://x/cb', verifier: 'v' };

describe('ConnectAccount', () => {
  it('begin returns the connector start', async () => {
    const { connect } = setup();
    expect(await connect.begin('google', 'http://x/cb')).toEqual({ url: 'https://auth', state: 's', verifier: 'v' });
  });

  it('rejects an unknown provider kind', async () => {
    const { connect } = setup();
    await expect(connect.begin('other', 'http://x')).rejects.toThrow(DomainError);
  });

  it('creates an account with a derived id, then ana-2 for another email with the same local part', async () => {
    const { connect, connector, repos, invalidate } = setup();
    const first = await connect.complete('google', input);
    expect(first).toMatchObject({ id: 'ana', status: 'active', createdVia: 'wizard', busyCalendars: ['primary'] });
    expect(connector.saved.has('ana')).toBe(true);
    expect(invalidate).toHaveBeenCalledWith('ana');
    connector.email = 'ana@other.com';
    expect((await connect.complete('google', input)).id).toBe('ana-2');
    expect((await repos.accounts.list()).map((a) => a.id)).toEqual(['ana', 'ana-2']);
  });

  it('records missing scopes', async () => {
    const { connect, connector } = setup();
    connector.granted = ['a'];
    expect((await connect.complete('google', input)).missingScopes).toEqual(['b']);
  });

  it('reuses a disabled account of the same email, keeping its settings, and reactivates it', async () => {
    const { connect, repos } = setup();
    const old: Account = {
      id: 'work',
      provider: 'google',
      email: EmailAddress.parse('Ana@Example.com'),
      status: 'disabled',
      busyCalendars: ['cal1'],
      missingScopes: ['a', 'b'],
      createdVia: 'config',
    };
    await repos.accounts.upsert(old);
    const account = await connect.complete('google', input, { createdVia: 'cli' });
    expect(account).toMatchObject({ id: 'work', status: 'active', busyCalendars: ['cal1'], missingScopes: [], createdVia: 'config' });
    expect(await repos.accounts.list()).toHaveLength(1);
  });

  it('clears the stale status detail of a reconnected account', async () => {
    const { connect, repos } = setup();
    await connect.complete('google', input);
    await repos.accounts.setStatus('ana', 'needs_reauth', 'invalid_grant');
    const account = await connect.complete('google', input);
    expect(account.statusDetail).toBeUndefined();
    expect((await repos.accounts.get('ana')).statusDetail).toBeUndefined();
  });

  it('creates no row and saves nothing when the connector fails', async () => {
    const { connect, connector, repos, invalidate } = setup();
    connector.fail = new Error('denied');
    await expect(connect.complete('google', input)).rejects.toThrow('denied');
    expect(await repos.accounts.list()).toEqual([]);
    expect(connector.saved.size).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('removes the credentials of a new id when the upsert fails', async () => {
    const { connect, connector, repos } = setup();
    vi.spyOn(repos.accounts, 'upsert').mockRejectedValue(new Error('db down'));
    await expect(connect.complete('google', input)).rejects.toThrow('db down');
    expect(connector.deleted).toEqual(['ana']);
  });

  it('uses the requested id and marks createdVia cli', async () => {
    const { connect } = setup();
    expect(await connect.complete('google', input, { accountId: 'me', createdVia: 'cli' })).toMatchObject({
      id: 'me',
      createdVia: 'cli',
    });
  });

  it('fails without saving when the requested id belongs to another email', async () => {
    const { connect, connector, repos } = setup();
    connector.email = 'bob@example.com';
    await connect.complete('google', input);
    connector.email = 'ana@example.com';
    await expect(connect.complete('google', input, { accountId: 'bob' })).rejects.toThrow(/already used/);
    expect(connector.saved.has('bob')).toBe(true);
    expect((await repos.accounts.list()).map((a) => a.id)).toEqual(['bob']);
  });

  it('fails when the email is already connected under a different id', async () => {
    const { connect, connector } = setup();
    await connect.complete('google', input);
    connector.saved.clear();
    await expect(connect.complete('google', input, { accountId: 'other' })).rejects.toThrow(/already connected as account "ana"/);
    expect(connector.saved.size).toBe(0);
  });
});

describe('RemoveAccount', () => {
  it('disables, deletes credentials and keeps data by default', async () => {
    const { connect, remove, connector, repos, invalidate } = setup();
    await connect.complete('google', input);
    const deleteData = vi.spyOn(repos.accounts, 'deleteData');
    invalidate.mockClear();
    await remove.execute('ana', { deleteData: false });
    expect((await repos.accounts.get('ana')).status).toBe('disabled');
    expect(connector.deleted).toEqual(['ana']);
    expect(deleteData).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith('ana');
  });

  it('deletes data when asked', async () => {
    const { connect, remove, repos } = setup();
    await connect.complete('google', input);
    const deleteData = vi.spyOn(repos.accounts, 'deleteData');
    await remove.execute('ana', { deleteData: true });
    expect(deleteData).toHaveBeenCalledWith('ana');
  });

  it('rejects an unknown account', async () => {
    const { remove } = setup();
    await expect(remove.execute('nope', { deleteData: false })).rejects.toThrow(DomainError);
  });
});

describe('SetBusyCalendars', () => {
  it('sets the calendars', async () => {
    const { connect, repos } = setup();
    await connect.complete('google', input);
    await new SetBusyCalendars(repos.accounts).execute('ana', ['primary', 'x']);
    expect((await repos.accounts.get('ana')).busyCalendars).toEqual(['primary', 'x']);
  });

  it('rejects an empty list and an unknown account', async () => {
    const { connect, repos } = setup();
    await connect.complete('google', input);
    const uc = new SetBusyCalendars(repos.accounts);
    await expect(uc.execute('ana', [])).rejects.toThrow(/at least one/);
    await expect(uc.execute('nope', ['primary'])).rejects.toThrow(DomainError);
  });
});
