import { beforeEach, describe, expect, it } from 'vitest';
import { InMemorySyncRequests } from '../../testing/in-memory-repositories';
import { RequestSync } from './request-sync';
import { UseCaseFixture } from './use-case-fixture.test-support';

describe('RequestSync', () => {
  let f: UseCaseFixture;
  let requests: InMemorySyncRequests;
  const useCase = () => new RequestSync(f.repos.accounts, requests);

  beforeEach(async () => {
    f = new UseCaseFixture();
    requests = new InMemorySyncRequests();
    await f.addAccount('a1');
    await f.addAccount('a2');
    await f.addAccount('off', 'needs_reauth');
  });

  it('requests every active account without an id', async () => {
    expect(await useCase().execute({})).toEqual(['a1', 'a2']);
    expect(await requests.pending()).toEqual(['a1', 'a2']);
  });

  it('requests only the given account', async () => {
    expect(await useCase().execute({ accountId: 'a2' })).toEqual(['a2']);
    expect(await requests.pending()).toEqual(['a2']);
  });

  it('rejects an unknown or non-active account and requests nothing', async () => {
    await expect(useCase().execute({ accountId: 'nope' })).rejects.toThrow('Account not active: nope');
    await expect(useCase().execute({ accountId: 'off' })).rejects.toThrow('Account not active: off');
    expect(await requests.pending()).toEqual([]);
  });
});
