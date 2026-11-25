import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../domain/errors';
import { message, MONDAY_20, thread, UseCaseFixture } from './use-case-fixture.test-support';
import { CreateDraft } from './create-draft';

describe('CreateDraft', () => {
  let f: UseCaseFixture;
  let uc: CreateDraft;

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
    uc = new CreateDraft(f.repos.accounts, f.registry);
  });

  it('requires "to" or "thread_id"', async () => {
    await expect(uc.execute({ body: 'hi' })).rejects.toThrow(new DomainError('Either "to" or "thread_id" is required'));
    await expect(uc.execute({ to: [], body: 'hi' })).rejects.toThrow('Either "to" or "thread_id" is required');
  });

  it('creates a draft for the given recipients and builds the gmail url', async () => {
    const create = vi.spyOn(f.providers.get('a1')!.mail, 'createDraft');
    const r = await uc.execute({ to: ['Ana <ana@client.com>'], cc: ['bob@client.com'], subject: 'Hello', body: 'hi' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].cc!.map((a) => a.address)).toEqual(['bob@client.com']);
    expect(r.to).toEqual(['ana@client.com']);
    expect(r.subject).toBe('Hello');
    expect(r.gmailUrl).toBe(`https://mail.google.com/mail/#drafts?compose=${r.draftId}`);
  });

  it('delegates a reply draft with threadId and no "to"', async () => {
    const create = vi.spyOn(f.providers.get('a1')!.mail, 'createDraft');
    f.providers.get('a1')!.mail.seed([thread([message('m1', 't1', 'a1', MONDAY_20)])]);
    const r = await uc.execute({ threadId: 't1', body: 'reply' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toEqual({ body: 'reply', threadId: 't1' });
    expect(r.threadId).toBe('t1');
  });

  it('creates the draft in the requested account, not the first active one', async () => {
    await f.addAccount('a2');
    const first = vi.spyOn(f.providers.get('a1')!.mail, 'createDraft');
    const second = vi.spyOn(f.providers.get('a2')!.mail, 'createDraft');
    await uc.execute({ to: ['x@y.com'], body: 'hi', accountId: 'a2' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    await expect(uc.execute({ to: ['x@y.com'], body: 'hi', accountId: 'zz' })).rejects.toThrow();
  });

  it('rejects invalid addresses and inactive accounts', async () => {
    await expect(uc.execute({ to: ['nope'], body: 'x' })).rejects.toThrow(new DomainError('Invalid address: nope'));
    await expect(uc.execute({ to: ['a@b.com'], cc: ['bad'], body: 'x' })).rejects.toThrow('Invalid address: bad');
    await f.addAccount('a2', 'needs_reauth');
    await expect(uc.execute({ to: ['a@b.com'], body: 'x', accountId: 'a2' })).rejects.toThrow('Account not active: a2');
  });
});
