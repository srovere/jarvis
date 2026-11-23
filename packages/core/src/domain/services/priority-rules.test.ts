import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { EmailAddress } from '../model/email-address';
import type { MailThreadSummary } from '../model/mail';
import type { PersonLinkLookup } from '../ports/repositories';
import { PriorityRules } from './priority-rules';

const me = EmailAddress.parse('me@x.com');
const base = DateTime.fromISO('2026-11-23T12:00:00', { zone: 'America/Argentina/Buenos_Aires' });

const thread = (id: string, over: Partial<MailThreadSummary> = {}): MailThreadSummary => ({
  id,
  accountId: 'acc',
  subject: id,
  lastMessageAt: base,
  unread: true,
  labels: [],
  participants: [],
  lastFrom: EmailAddress.parse('someone@y.com'),
  snippet: '',
  ...over,
});

const links = (linked: string[] = []): PersonLinkLookup => ({
  isLinkedToAnyProject: async (e) => linked.includes(e.address),
});

describe('PriorityRules', () => {
  it('excludes unread promotions', async () => {
    const out = await new PriorityRules(links()).rank([thread('p', { labels: ['CATEGORY_PROMOTIONS'] })], [me], 10);
    expect(out).toEqual([]);
  });

  it('includes unread threads without category', async () => {
    const out = await new PriorityRules(links()).rank([thread('a')], [me], 10);
    expect(out.map((t) => t.id)).toEqual(['a']);
  });

  it('includes read but starred threads, and excludes read plain ones', async () => {
    const out = await new PriorityRules(links()).rank(
      [thread('s', { unread: false, labels: ['STARRED'] }), thread('r', { unread: false })],
      [me],
      10,
    );
    expect(out.map((t) => t.id)).toEqual(['s']);
  });

  it('puts linked threads first even when read and older', async () => {
    const client = EmailAddress.parse('cliente@x.com');
    const out = await new PriorityRules(links(['cliente@x.com'])).rank(
      [thread('new', { lastMessageAt: base }), thread('client', { unread: false, lastFrom: client, lastMessageAt: base.minus({ days: 2 }) })],
      [me],
      10,
    );
    expect(out.map((t) => t.id)).toEqual(['client', 'new']);
  });

  it('excludes spam and trash even if linked or starred', async () => {
    const client = EmailAddress.parse('cliente@x.com');
    const out = await new PriorityRules(links(['cliente@x.com'])).rank(
      [thread('a', { lastFrom: client, labels: ['SPAM'] }), thread('b', { labels: ['STARRED', 'TRASH'] })],
      [me],
      10,
    );
    expect(out).toEqual([]);
  });

  it('does not treat own address as linked', async () => {
    const out = await new PriorityRules(links(['me@x.com'])).rank([thread('o', { unread: false, lastFrom: me })], [me], 10);
    expect(out).toEqual([]);
  });

  it('cuts at limit', async () => {
    const many = Array.from({ length: 15 }, (_, i) => thread(`t${i}`, { lastMessageAt: base.minus({ minutes: i }) }));
    const out = await new PriorityRules(links()).rank(many, [me], 10);
    expect(out).toHaveLength(10);
    expect(out[0]!.id).toBe('t0');
  });
});
