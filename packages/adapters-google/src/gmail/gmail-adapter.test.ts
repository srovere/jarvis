import { afterEach, describe, expect, it } from 'vitest';
import { DomainError, EmailAddress, ReauthRequired, ThreadNotFound } from '@jarvis/core';
import { buildMessage, buildThread, T0 } from '@jarvis/contracts';
import { FakeGmail } from './__fixtures__/fake-gmail';
import { GmailAdapter } from './gmail-adapter';
import { htmlToPlainText } from '../html-to-text';

const OPTS = { initialWindowDays: 90 };
const fakes: FakeGmail[] = [];

function setup(opts: ConstructorParameters<typeof FakeGmail>[0] = {}) {
  const fake = new FakeGmail({ now: () => T0.plus({ hours: 1 }).toMillis(), ...opts });
  fakes.push(fake);
  return { fake, adapter: new GmailAdapter(fake.asGmail(), 'acc') };
}

afterEach(() => {
  for (const f of fakes.splice(0)) {
    expect(f.sendSpy).not.toHaveBeenCalled();
    expect(f.draftSendSpy).not.toHaveBeenCalled();
  }
});

const msg = (id: string, minutes: number, extra: Partial<Parameters<typeof buildMessage>[0]> = {}) =>
  buildMessage({ id, threadId: 't1', from: 'a@y.com', to: ['me@x.com'], minutes, ...extra });

describe('GmailAdapter drafts', () => {
  it('replies to the non-own recipient when the last message is from an alias (Review Focus 2)', async () => {
    const { fake, adapter } = setup({ sendAs: ['me@x.com', 'yo@gmail.com'] });
    fake.seed([
      buildThread('t1', 'Hello', [
        msg('m1', 0, { from: 'cliente@x.com', to: ['yo@gmail.com'] }),
        msg('m2', 5, { from: 'yo@gmail.com', to: ['cliente@x.com'] }),
      ]),
    ]);
    const ref = await adapter.createDraft({ threadId: 't1', body: 'ok' });
    expect(ref.to.map((x) => x.address)).toEqual(['cliente@x.com']);
  });

  it('builds the MIME with From = primary sendAs, threading headers and threadId', async () => {
    const { fake, adapter } = setup({ sendAs: ['me@x.com', 'yo@gmail.com'] });
    fake.seed([
      buildThread('t1', 'Reunión', [
        msg('m1', 0, { subject: 'Reunión' }),
        { ...msg('m2', 5, { subject: 'Reunión' }), referencesHeader: '<m0@x>', messageIdHeader: '<m2@x>' },
      ]),
    ]);
    const ref = await adapter.createDraft({ threadId: 't1', body: 'ok', cc: [EmailAddress.parse('d@y.com')] });
    expect(ref.subject).toBe('Re: Reunión');
    const draft = fake.drafts[0]!;
    expect(draft.threadId).toBe('t1');
    expect(draft.mime).toContain('From: me@x.com\r\n');
    expect(draft.mime).toContain('To: a@y.com\r\n');
    expect(draft.mime).toContain('Cc: d@y.com\r\n');
    expect(draft.mime).toContain('In-Reply-To: <m2@x>\r\n');
    expect(draft.mime).toContain('References: <m0@x> <m2@x>\r\n');
    expect(fake.calls.draftsCreate).toHaveBeenCalledTimes(1);
  });

  it('caches the sendAs list per adapter instance', async () => {
    const { fake, adapter } = setup();
    await adapter.createDraft({ to: [EmailAddress.parse('c@y.com')], body: 'x' });
    await adapter.createDraft({ to: [EmailAddress.parse('c@y.com')], body: 'y' });
    await adapter.ownAddresses();
    expect(fake.calls.sendAsList).toHaveBeenCalledTimes(1);
    expect(fake.drafts).toHaveLength(2);
  });

  it('anchors a second draft on the real last message, not on the first (unsent) draft', async () => {
    const { fake, adapter } = setup();
    fake.seed([
      buildThread('t1', 'Hello', [{ ...msg('m1', 0), messageIdHeader: '<m1@x>' }]),
    ]);
    await adapter.createDraft({ threadId: 't1', body: 'uno' });
    const ref = await adapter.createDraft({ threadId: 't1', body: 'dos' });
    expect(ref.to.map((x) => x.address)).toEqual(['a@y.com']);
    const second = fake.drafts[1]!.mime;
    expect(second).toContain('In-Reply-To: <m1@x>\r\n');
    expect(second).toContain('References: <m1@x>\r\n');
  });

  it('sync after a draft is created contains no upsert for the draft', async () => {
    const { fake, adapter } = setup();
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0)])]);
    const first = await adapter.sync(null, OPTS);
    await adapter.createDraft({ threadId: 't1', body: 'uno' });
    const r = await adapter.sync(first.nextCursor, OPTS);
    expect(r.changes.some((c) => c.kind === 'upsert')).toBe(false);
    const full = await adapter.sync(null, OPTS);
    expect(full.changes.flatMap((c) => (c.kind === 'upsert' ? [c.message.labels] : [])).flat()).not.toContain('DRAFT');
  });

  it('walks back to the last non-own sender when the last message is own and all recipients are own', async () => {
    const { fake, adapter } = setup({ sendAs: ['me@x.com', 'yo@gmail.com'] });
    fake.seed([
      buildThread('t1', 'Nota', [
        msg('m1', 0, { from: 'b@y.com', to: ['me@x.com'] }),
        msg('m2', 5, { from: 'me@x.com', to: ['yo@gmail.com'] }),
      ]),
    ]);
    const ref = await adapter.createDraft({ threadId: 't1', body: 'ok' });
    expect(ref.to.map((x) => x.address)).toEqual(['b@y.com']);
  });

  it('throws a DomainError when a self-only thread has no one to reply to', async () => {
    const { fake, adapter } = setup({ sendAs: ['me@x.com', 'yo@gmail.com'] });
    fake.seed([buildThread('t1', 'Nota', [msg('m1', 0, { from: 'me@x.com', to: ['yo@gmail.com'] })])]);
    await expect(adapter.createDraft({ threadId: 't1', body: 'x' })).rejects.toThrow(
      'No recipient to reply to in this thread',
    );
  });

  it('rejects a draft for an unknown thread with a DomainError', async () => {
    const { adapter } = setup();
    await expect(adapter.createDraft({ threadId: 'nope', body: 'x' })).rejects.toBeInstanceOf(DomainError);
  });
});

describe('GmailAdapter reading', () => {
  it('returns only bodyHtml for an HTML-only message', async () => {
    const { fake, adapter } = setup();
    fake.seed([buildThread('t1', 'Hello', [{ ...msg('m1', 0), bodyHtml: '<p>Hello <b>world</b></p>' }])]);
    const m = (await adapter.getThread('t1')).messages[0]!;
    expect(m.bodyHtml).toBe('<p>Hello <b>world</b></p>');
    expect(m.bodyText).toBeUndefined();
  });

  it('decodes text/plain and text/html, honouring the declared charset', async () => {
    const { fake, adapter } = setup();
    fake.seed([buildThread('t1', 'Hello', [{ ...msg('m1', 0), bodyText: 'ñandú ✓', bodyHtml: '<p>ñandú</p>' }])]);
    const m = (await adapter.getThread('t1')).messages[0]!;
    expect(m.bodyText).toBe('ñandú ✓');
    expect(m.bodyHtml).toBe('<p>ñandú</p>');
    expect(m.date.toMillis()).toBe(T0.toMillis());
    expect(m.date.zoneName).toBe('UTC');
    expect(m.accountId).toBe('acc');
  });

  it('decodes latin1 bodies from the Content-Type charset and falls back to utf-8 for unknown ones', async () => {
    const message = (charset: string, bytes: Buffer) => ({
      id: 'm1',
      threadId: 't1',
      internalDate: String(T0.toMillis()),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@y.com' },
          { name: 'Content-Type', value: `text/plain; charset="${charset}"` },
        ],
        body: { data: bytes.toString('base64url') },
      },
    });
    const gmail = {
      users: {
        threads: {
          get: async ({ id }: { id: string }) => ({
            data: {
              id,
              messages: [id === 'latin' ? message('iso-8859-1', Buffer.from('ñandú', 'latin1')) : message('x-unknown', Buffer.from('ñandú'))],
            },
          }),
        },
      },
    };
    const adapter = new GmailAdapter(gmail as never, 'acc');
    expect((await adapter.getThread('latin')).messages[0]!.bodyText).toBe('ñandú');
    expect((await adapter.getThread('weird')).messages[0]!.bodyText).toBe('ñandú');
  });

  it('skips unparseable addresses instead of failing the message', async () => {
    const gmail = {
      users: {
        threads: {
          get: async () => ({
            data: {
              id: 't1',
              messages: [
                {
                  id: 'm1',
                  threadId: 't1',
                  internalDate: String(T0.toMillis()),
                  labelIds: ['INBOX', 'UNREAD'],
                  payload: {
                    headers: [
                      { name: 'From', value: '"Pérez, Ana" <ana@y.com>' },
                      { name: 'To', value: 'basura, b@y.com, =?UTF-8?B?w5FhbmTDug==?= <n@y.com>' },
                      { name: 'Subject', value: '=?UTF-8?B?UmV1bmnDs24=?=' },
                    ],
                  },
                },
              ],
            },
          }),
        },
      },
    };
    const t = await new GmailAdapter(gmail as never, 'acc').getThread('t1');
    const m = t.messages[0]!;
    expect(m.from.address).toBe('ana@y.com');
    expect(m.from.name).toBe('Pérez, Ana');
    expect(m.to.map((x) => x.address)).toEqual(['b@y.com', 'n@y.com']);
    expect(m.to[1]!.name).toBe('Ñandú');
    expect(m.subject).toBe('Reunión');
    expect(t.unread).toBe(true);
  });

  it('listThreads fetches metadata with the fixed headers', async () => {
    const { fake, adapter } = setup();
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0)])]);
    const found = await adapter.listThreads({ query: 'hello', maxResults: 5 });
    expect(found.map((t) => t.id)).toEqual(['t1']);
    expect(found[0]!.lastFrom.address).toBe('a@y.com');
    expect(fake.calls.threadsGet).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] }),
    );
  });
});

describe('GmailAdapter sync', () => {
  it('full sync paginates, windows by newer_than and uses the profile historyId as cursor', async () => {
    const { fake, adapter } = setup({ pageSize: 2 });
    fake.seed([
      buildThread('t1', 'Hello', [msg('m1', 0), msg('m2', 1), msg('m3', 2)]),
      buildThread('old', 'Viejo', [
        buildMessage({ id: 'old1', threadId: 'old', from: 'a@y.com', to: ['me@x.com'], minutes: -200 * 24 * 60 }),
      ]),
    ]);
    const r = await adapter.sync(null, { initialWindowDays: 90 });
    expect(r.fullResync).toBe(true);
    expect(r.changes.map((c) => (c.kind === 'upsert' ? c.message.id : '')).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(fake.calls.messagesList).toHaveBeenCalledWith(expect.objectContaining({ q: 'newer_than:90d' }));
    expect(fake.calls.messagesList.mock.calls.length).toBeGreaterThan(1);
    expect(r.nextCursor).toBe(String(Number(r.nextCursor)));
    expect(fake.calls.messagesGet).toHaveBeenCalledWith(expect.objectContaining({ format: 'metadata' }));
  });

  it('incremental sync dedupes per message id and maps added, relabelled and deleted messages', async () => {
    const { fake, adapter } = setup({ pageSize: 1 });
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0), msg('m2', 1)])]);
    const first = await adapter.sync(null, OPTS);
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0), msg('m2', 1), msg('m3', 2)])]);
    fake.setLabels('m1', ['INBOX', 'STARRED']);
    fake.setLabels('m1', ['INBOX']);
    fake.removeMessage('m2');
    const r = await adapter.sync(first.nextCursor, OPTS);
    expect(r.fullResync).toBe(false);
    const ups = r.changes.flatMap((c) => (c.kind === 'upsert' ? [c.message.id] : []));
    expect(ups.sort()).toEqual(['m1', 'm3']);
    expect(r.changes.filter((c) => c.kind === 'delete')).toEqual([{ kind: 'delete', messageId: 'm2' }]);
    expect(fake.calls.historyList.mock.calls.length).toBeGreaterThan(1);
    expect(fake.calls.historyList).toHaveBeenCalledWith(
      expect.objectContaining({ historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'] }),
    );
    expect(Number(r.nextCursor)).toBeGreaterThan(Number(first.nextCursor));
    const again = await adapter.sync(r.nextCursor, OPTS);
    expect(again.changes).toEqual([]);
  });

  it('falls back to a full resync when history.list answers 404 (Review Focus 1)', async () => {
    const { fake, adapter } = setup();
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0)])]);
    fake.expireHistory();
    const r = await adapter.sync('123', OPTS);
    expect(r.fullResync).toBe(true);
    expect(r.nextCursor).not.toBe('123');
    expect(r.changes).toHaveLength(1);
  });

  it('turns a stored message that is now in TRASH or SPAM into a delete', async () => {
    const { fake, adapter } = setup();
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0), msg('m2', 1)])]);
    const first = await adapter.sync(null, OPTS);
    fake.setLabels('m1', ['TRASH']);
    fake.setLabels('m2', ['INBOX', 'SPAM']);
    const r = await adapter.sync(first.nextCursor, OPTS);
    expect(r.changes).toEqual(
      expect.arrayContaining([
        { kind: 'delete', messageId: 'm1' },
        { kind: 'delete', messageId: 'm2' },
      ]),
    );
    expect(r.changes.some((c) => c.kind === 'upsert')).toBe(false);
  });

  it('treats a 404 on a history-referenced message as a delete', async () => {
    const { fake, adapter } = setup();
    const first = await adapter.sync(null, OPTS);
    fake.seed([buildThread('t1', 'Hello', [msg('m1', 0)])]);
    fake.dropMessageSilently('m1');
    const r = await adapter.sync(first.nextCursor, OPTS);
    expect(r.changes).toEqual([{ kind: 'delete', messageId: 'm1' }]);
  });
});

describe('GmailAdapter error mapping', () => {
  it('getThread and a reply draft on a missing thread throw ThreadNotFound', async () => {
    const { adapter } = setup();
    await expect(adapter.getThread('zz')).rejects.toThrow(ThreadNotFound);
    await expect(adapter.getThread('zz')).rejects.toThrow('Thread not found: zz');
    await expect(adapter.createDraft({ threadId: 'zz', body: 'x' })).rejects.toThrow(ThreadNotFound);
  });

  const invalidGrant = Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } });
  const failing = (error: unknown) =>
    new GmailAdapter({ users: { getProfile: async () => { throw error; }, settings: { sendAs: { list: async () => { throw error; } } } } } as never, 'acc');

  it('maps invalid_grant to ReauthRequired', async () => {
    await expect(failing(invalidGrant).sync(null, OPTS)).rejects.toBeInstanceOf(ReauthRequired);
    await expect(failing(invalidGrant).ownAddresses()).rejects.toMatchObject({ accountId: 'acc' });
  });

  it('propagates other errors untouched', async () => {
    const boom = new Error('boom');
    await expect(failing(boom).sync(null, OPTS)).rejects.toBe(boom);
  });
});

describe('htmlToPlainText', () => {
  it('drops images, keeps link text only and does not wrap lines', () => {
    const long = 'palabra '.repeat(40).trim();
    const out = htmlToPlainText(`<p>${long}</p><img src="x.png" alt="logo"><a href="https://e.com">enlace</a>`);
    expect(out).toContain(long);
    expect(out).toContain('enlace');
    expect(out).not.toContain('https://e.com');
    expect(out).not.toContain('logo');
  });
});
