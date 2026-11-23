import { EmailAddress, type Account } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';

const account: Account = {
  id: 'personal',
  provider: 'google',
  email: EmailAddress.parse('me@example.com'),
  displayName: 'Me',
  status: 'active',
};

describe('DrizzleAccountRepository', () => {
  const t = useTestDb();
  const repo = () => new DrizzleAccountRepository(t.db());

  it('upserts idempotently and reads back the domain object', async () => {
    await repo().upsert(account);
    await repo().upsert({ ...account, displayName: 'Renamed' });
    const all = await repo().list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'personal', provider: 'google', displayName: 'Renamed', status: 'active' });
    expect(all[0]!.email.address).toBe('me@example.com');
    expect((await repo().get('personal')).id).toBe('personal');
  });

  it('setStatus stores the status and its detail', async () => {
    await repo().upsert(account);
    await repo().setStatus('personal', 'needs_reauth', 'invalid_grant');
    expect((await repo().get('personal')).status).toBe('needs_reauth');
    const rows = await t.db().query.accounts.findFirst();
    expect(rows?.statusDetail).toBe('invalid_grant');
  });

  it('get and setStatus fail for an unknown account', async () => {
    await expect(repo().get('nope')).rejects.toThrow(/not found/i);
    await expect(repo().setStatus('nope', 'disabled')).rejects.toThrow(/not found/i);
  });
});
