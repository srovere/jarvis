import { EmailAddress } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleSyncRequests } from './sync-requests.repository';

describe('DrizzleSyncRequests', () => {
  const t = useTestDb();

  async function seed() {
    const accounts = new DrizzleAccountRepository(t.db());
    for (const id of ['a1', 'a2']) {
      await accounts.upsert({
        id,
        provider: 'google',
        email: EmailAddress.parse(`${id}@example.com`),
        status: 'active',
        busyCalendars: ['primary'],
        missingScopes: [],
        createdVia: 'wizard',
      });
    }
    return new DrizzleSyncRequests(t.db());
  }

  it('has nothing pending at first', async () => {
    expect(await (await seed()).pending()).toEqual([]);
  });

  it('marks requested accounts as pending and clears them one by one', async () => {
    const requests = await seed();
    await requests.request(['a1', 'a2']);
    expect((await requests.pending()).sort()).toEqual(['a1', 'a2']);
    await requests.clear('a1');
    expect(await requests.pending()).toEqual(['a2']);
    await requests.clear('a2');
    expect(await requests.pending()).toEqual([]);
  });

  it('ignores an empty or unknown request', async () => {
    const requests = await seed();
    await requests.request([]);
    await requests.request(['nope']);
    expect(await requests.pending()).toEqual([]);
  });
});
