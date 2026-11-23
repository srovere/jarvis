import { describe, expect, it } from 'vitest';
import { EmailAddress } from '@jarvis/core';
import { decodeMimeWords } from './gmail-mapper';
import { buildMime } from './mime-builder';

const a = (s: string) => EmailAddress.parse(s);
const decode = (raw: string): string => Buffer.from(raw, 'base64url').toString('utf8');
const split = (raw: string): { head: string; body: string } => {
  const [head, body] = decode(raw).split('\r\n\r\n');
  return { head: head!, body: body! };
};
const base = { from: a('me@x.com'), to: [a('c@y.com')], cc: [], subject: 'Hello', body: 'body' };

describe('buildMime', () => {
  it('encodes a non-ASCII subject as RFC 2047 and round-trips', () => {
    const { head } = split(buildMime({ ...base, subject: 'Reunión ñandú' }));
    const line = head.split('\r\n').find((l) => l.startsWith('Subject: '))!;
    expect(line).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(decodeMimeWords(line.slice('Subject: '.length))).toBe('Reunión ñandú');
  });

  it('leaves an ASCII subject as is and uses CRLF with the fixed headers', () => {
    const { head } = split(buildMime(base));
    expect(head.split('\r\n')).toEqual([
      'From: me@x.com',
      'To: c@y.com',
      'Subject: Hello',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ]);
    expect(decode(buildMime(base))).not.toMatch(/[^\r]\n/);
  });

  it('includes Cc, In-Reply-To and References when given', () => {
    const { head } = split(
      buildMime({ ...base, cc: [a('d@y.com')], inReplyTo: '<2@x>', references: '<1@x> <2@x>' }),
    );
    expect(head).toContain('\r\nCc: d@y.com');
    expect(head).toContain('\r\nIn-Reply-To: <2@x>');
    expect(head).toContain('\r\nReferences: <1@x> <2@x>');
  });

  it('base64-encodes a UTF-8 body and the whole message as base64url', () => {
    const raw = buildMime({ ...base, body: 'line 1\nñandú ✓' });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const body = Buffer.from(split(raw).body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(body).toBe('line 1\r\nñandú ✓');
  });

  it('folds a long non-ASCII subject into several encoded words that decode back', () => {
    const subject = 'ñ'.repeat(80);
    const { head } = split(buildMime({ ...base, subject }));
    const start = head.indexOf('Subject: ');
    const end = head.indexOf('\r\nMIME-Version');
    const value = head.slice(start + 'Subject: '.length, end).replace(/\r\n /g, ' ');
    expect(value.split(' ').every((w) => w.length <= 75)).toBe(true);
    expect(decodeMimeWords(value)).toBe(subject);
  });

  it('strips line breaks from header values (no header injection)', () => {
    const { head } = split(buildMime({ ...base, subject: 'Hello\r\nBcc: evil@z.com' }));
    expect(head).not.toContain('\r\nBcc:');
  });

  it('encodes non-ASCII display names', () => {
    const { head } = split(buildMime({ ...base, to: [a('José <j@y.com>')] }));
    const to = head.split('\r\n').find((l) => l.startsWith('To: '))!;
    expect(to).toMatch(/^To: =\?UTF-8\?B\?.+\?= <j@y\.com>$/);
  });
});
