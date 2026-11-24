import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError, ThreadNotFound } from '../../domain/errors';
import { staticSettings, message, MONDAY_20, thread, UseCaseFixture } from './use-case-fixture.test-support';
import { ReadThread } from './read-thread';

describe('ReadThread', () => {
  let f: UseCaseFixture;
  const useCase = () => new ReadThread(f.repos.accounts, f.registry, f.cleaner, staticSettings());

  beforeEach(async () => {
    f = new UseCaseFixture();
    const a1 = await f.addAccount('a1');
    const a2 = await f.addAccount('a2');
    a1.mail.seed([thread([message('m1', 't1', 'a1', MONDAY_20)])]);
    a2.mail.seed([
      thread([
        message('n2', 'u1', 'a2', MONDAY_20.minus({ hours: 1 }), { bodyText: 'Respuesta\n> cita' }),
        message('n1', 'u1', 'a2', MONDAY_20.minus({ hours: 2 }), { bodyText: 'Hello' }),
      ]),
    ]);
  });

  it('reads the thread from the given account with clean bodies in chronological order', async () => {
    const r = await useCase().execute({ accountId: 'a2', threadId: 'u1' });
    expect(r.threadId).toBe('u1');
    expect(r.subject).toBe('Subject u1');
    expect(r.messages.map((m) => [m.id, m.body, m.date])).toEqual([
      ['n1', 'Hello', '2026-11-23T18:00:00.000-03:00'],
      ['n2', 'Respuesta', '2026-11-23T19:00:00.000-03:00'],
    ]);
  });

  it('without accountId tries each active account until the thread is found', async () => {
    expect((await useCase().execute({ threadId: 'u1' })).messages).toHaveLength(2);
  });

  it('throws Thread not found when no active account has it', async () => {
    await expect(useCase().execute({ threadId: 'zz' })).rejects.toThrow(new ThreadNotFound('zz'));
  });

  it('with accountId does not fall back to other accounts', async () => {
    await expect(useCase().execute({ accountId: 'a1', threadId: 'u1' })).rejects.toThrow(new ThreadNotFound('u1'));
  });

  it('only ThreadNotFound moves on to the next account; other errors propagate', async () => {
    vi.spyOn(f.providers.get('a1')!.mail, 'getThread').mockRejectedValue(new DomainError('Thread not found: u1'));
    await expect(useCase().execute({ threadId: 'u1' })).rejects.not.toBeInstanceOf(ThreadNotFound);
    vi.spyOn(f.providers.get('a1')!.mail, 'getThread').mockRejectedValue(new ThreadNotFound('u1'));
    expect((await useCase().execute({ threadId: 'u1' })).messages).toHaveLength(2);
  });

  it('the final error is a ThreadNotFound', async () => {
    await expect(useCase().execute({ threadId: 'zz' })).rejects.toBeInstanceOf(ThreadNotFound);
  });
});
