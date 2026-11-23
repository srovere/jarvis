import { describe, expect, it } from 'vitest';
import { EmailCleaner } from './email-cleaner';

const htmlToText = (html: string) => html.replace(/<[^>]+>/g, '');
const cleaner = () => new EmailCleaner({ htmlToText });
const snippet = 'snip';

describe('EmailCleaner', () => {
  it('prefers bodyText over bodyHtml', () => {
    expect(cleaner().clean({ bodyText: 'texto', bodyHtml: '<p>html</p>', snippet })).toBe('texto');
  });

  it('uses htmlToText when only bodyHtml exists', () => {
    expect(cleaner().clean({ bodyHtml: '<p>hola</p>', snippet })).toBe('hola');
  });

  it('cuts at English quote header', () => {
    const body = 'Thanks\n\nOn Mon, Nov 3, 2026 at 10:00 AM Ann <a@x.com> wrote:\n> old';
    expect(cleaner().clean({ bodyText: body, snippet })).toBe('Thanks');
  });

  it('cuts at Spanish quote header on one line', () => {
    const body = 'Gracias\nEl lun, 3 nov 2026 a las 10:00, Ana <ana@x.com> escribió:\n> viejo';
    expect(cleaner().clean({ bodyText: body, snippet })).toBe('Gracias');
  });

  it('cuts at Spanish quote header wrapped across two lines', () => {
    const body = 'Gracias\n\nEl lun, 3 nov 2026 a las 10:00, Ana Pérez <ana@x.com>\nescribió:\n> viejo';
    expect(cleaner().clean({ bodyText: body, snippet })).toBe('Gracias');
  });

  it('cuts at Original Message and De/Enviado headers', () => {
    expect(cleaner().clean({ bodyText: 'ok\n-----Original Message-----\nx', snippet })).toBe('ok');
    expect(cleaner().clean({ bodyText: 'ok\n--- Mensaje original ---\nx', snippet })).toBe('ok');
    expect(cleaner().clean({ bodyText: 'ok\nDe: a@x.com\nEnviado: ayer\nx', snippet })).toBe('ok');
  });

  it('cuts at a block of > quoted lines', () => {
    expect(cleaner().clean({ bodyText: 'ok\n> a\n> b', snippet })).toBe('ok');
  });

  it('removes signature and mobile footers', () => {
    expect(cleaner().clean({ bodyText: 'ok\n-- \nSantiago\n555', snippet })).toBe('ok');
    expect(cleaner().clean({ bodyText: 'ok\n--\nS', snippet })).toBe('ok');
    expect(cleaner().clean({ bodyText: 'ok\nEnviado desde mi iPhone', snippet })).toBe('ok');
    expect(cleaner().clean({ bodyText: 'ok\nSent from my iPhone', snippet })).toBe('ok');
  });

  it('collapses 3+ newlines and trims', () => {
    expect(cleaner().clean({ bodyText: '  a\n\n\n\n\nb  \n', snippet })).toBe('a\n\nb');
  });

  it('truncates long input with marker', () => {
    const out = cleaner().clean({ bodyText: 'a'.repeat(10000), snippet });
    expect(out.length).toBeLessThanOrEqual(4040);
    expect(out.endsWith('\n[… truncado, 10000 caracteres en total]')).toBe(true);
  });

  it('handles HTML-only huge Spanish quoted message', () => {
    const html = `<p>${'x'.repeat(5000)}</p>\nEl lun, 3 nov 2026, Ana\nescribió:\n${'y'.repeat(9000)}`;
    const out = cleaner().clean({ bodyHtml: html, snippet });
    expect(out).toContain('[… truncado, 5000 caracteres en total]');
    expect(out).not.toContain('y');
  });

  it('falls back to decoded snippet when no body', () => {
    expect(cleaner().clean({ snippet: 'It&#39;s &quot;ok&quot; &amp; &lt;b&gt; &#233; ' })).toBe(
      'It\'s "ok" & <b> é',
    );
  });
});
