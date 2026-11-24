import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staticSettings, message, MONDAY_20, thread, UseCaseFixture, type AccountProviders } from './use-case-fixture.test-support';
import { SearchEmails } from './search-emails';

describe('SearchEmails', () => {
  let f: UseCaseFixture;
  let a1: AccountProviders;
  const useCase = () => new SearchEmails(f.repos.accounts, f.registry, f.cleaner, staticSettings());

  beforeEach(async () => {
    f = new UseCaseFixture();
    a1 = await f.addAccount('a1');
  });

  it('clamps maxResults to 20', async () => {
    a1.mail.seed(Array.from({ length: 25 }, (_, i) => thread([message(`m${i}`, `t${i}`, 'a1', MONDAY_20.minus({ hours: i }))])));
    const listThreads = vi.spyOn(a1.mail, 'listThreads');

    const results = await useCase().execute({ query: 'subject', maxResults: 50 });

    expect(listThreads).toHaveBeenCalledWith({ query: 'subject', maxResults: 20 });
    expect(results).toHaveLength(20);
  });

  it('defaults to 5 results and never asks for fewer than 1', async () => {
    a1.mail.seed(Array.from({ length: 8 }, (_, i) => thread([message(`m${i}`, `t${i}`, 'a1', MONDAY_20.minus({ hours: i }))])));
    const listThreads = vi.spyOn(a1.mail, 'listThreads');
    expect(await useCase().execute({ query: '' })).toHaveLength(5);
    await useCase().execute({ query: '', maxResults: 0 });
    expect(listThreads).toHaveBeenLastCalledWith({ query: '', maxResults: 1 });
  });

  it('returns the latest message of each thread with a clean body, across active accounts, newest first', async () => {
    const a2 = await f.addAccount('a2');
    await f.addAccount('off', 'needs_reauth');
    const offList = vi.spyOn(f.providers.get('off')!.mail, 'listThreads');
    a1.mail.seed([
      thread([
        message('m1', 't1', 'a1', MONDAY_20.minus({ hours: 5 })),
        message('m2', 't1', 'a1', MONDAY_20.minus({ hours: 3 }), {
          bodyText: 'Dale, nos vemos.\n\nOn Mon, Nov 23, 2026 at 10:00 AM Ana <ana@client.com> wrote:\n> cita vieja',
        }),
      ]),
    ]);
    a2.mail.seed([thread([message('n1', 'u1', 'a2', MONDAY_20.minus({ hours: 1 }))])]);

    const results = await useCase().execute({ query: 'subject', maxResults: 5 });

    expect(results.map((r) => r.id)).toEqual(['n1', 'm2']);
    expect(results[1]).toEqual({
      id: 'm2',
      accountId: 'a1',
      threadId: 't1',
      from: 'Ana <ana@client.com>',
      subject: 'Subject t1',
      date: '2026-11-23T17:00:00.000-03:00',
      body: 'Dale, nos vemos.',
    });
    expect(offList).not.toHaveBeenCalled();
  });

  it('searches only the given account, even when another one would fill the top results', async () => {
    const a2 = await f.addAccount('a2');
    a1.mail.seed(Array.from({ length: 5 }, (_, i) => thread([message(`m${i}`, `t${i}`, 'a1', MONDAY_20.minus({ hours: i }))])));
    a2.mail.seed([thread([message('n1', 'u1', 'a2', MONDAY_20.minus({ days: 30 }))])]);
    const a1List = vi.spyOn(a1.mail, 'listThreads');

    const results = await useCase().execute({ query: '', maxResults: 3, accountId: 'a2' });

    expect(results.map((r) => r.threadId)).toEqual(['u1']);
    expect(a1List).not.toHaveBeenCalled();
  });

  it('rejects an account that is not active', async () => {
    await f.addAccount('off', 'needs_reauth');
    await expect(useCase().execute({ query: 'x', accountId: 'off' })).rejects.toThrow(/not active/);
  });
});
