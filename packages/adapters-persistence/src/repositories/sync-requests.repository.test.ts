import { EmailAddress } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleSyncRequests } from './sync-requests.repository';

const ids = async (r: DrizzleSyncRequests) => (await r.pending()).map((p) => p.accountId);

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
    expect((await ids(requests)).sort()).toEqual(['a1', 'a2']);
    await requests.clear('a1', new Date());
    expect(await ids(requests)).toEqual(['a2']);
    await requests.clear('a2', new Date());
    expect(await ids(requests)).toEqual([]);
  });

  it('ignores an empty or unknown request', async () => {
    const requests = await seed();
    await requests.request([]);
    await requests.request(['nope']);
    expect(await requests.pending()).toEqual([]);
  });

  it('keeps a request made after the observed time (compare-and-clear)', async () => {
    const requests = await seed();
    await requests.request(['a1']);
    const [observed] = await requests.pending();
    await new Promise((r) => setTimeout(r, 20));
    await requests.request(['a1']); // arrives while the account is syncing
    await requests.clear('a1', observed!.requestedAt);
    expect(await ids(requests)).toEqual(['a1']);
    const [latest] = await requests.pending();
    await requests.clear('a1', latest!.requestedAt);
    expect(await ids(requests)).toEqual([]);
  });
});
