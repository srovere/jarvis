import type { EmailAddress } from '@jarvis/core';

export interface MimeDraft {
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

const CRLF = '\r\n';
const NON_ASCII = /[^\x20-\x7e]/;
// Un encoded-word completo mide como máximo 75 caracteres; 45 bytes UTF-8 -> 60 en base64 + 12 de envoltorio.
const MAX_WORD_BYTES = 45;

const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

function encodedWords(text: string): string {
  const words: string[] = [];
  let chunk = '';
  const flush = (): void => {
    if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
    chunk = '';
  };
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > MAX_WORD_BYTES) flush();
    chunk += ch;
  }
  flush();
  return words.join(`${CRLF} `);
}

/** RFC 2047 sólo cuando hay caracteres no ASCII. */
function encodeHeaderText(text: string): string {
  const clean = oneLine(text);
  return NON_ASCII.test(clean) ? encodedWords(clean) : clean;
}

function formatAddress(a: EmailAddress): string {
  if (!a.name) return a.address;
  const clean = oneLine(a.name);
  if (NON_ASCII.test(clean)) return `${encodedWords(clean)} <${a.address}>`;
  const display = /^[\w !#$%&'*+\-/=?^`{|}~]+$/.test(clean) ? clean : `"${clean.replace(/(["\\])/g, '\\$1')}"`;
  return `${display} <${a.address}>`;
}

const addressList = (list: EmailAddress[]): string => list.map(formatAddress).join(', ');

function base64Lines(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return (b64.match(/.{1,76}/g) ?? []).join(CRLF);
}

/** Construye un mensaje RFC 5322 `text/plain; charset=UTF-8` y lo devuelve codificado en base64url (campo `raw` de Gmail). */
export function buildMime(d: MimeDraft): string {
  const headers = [
    `From: ${formatAddress(d.from)}`,
    `To: ${addressList(d.to)}`,
    ...(d.cc.length > 0 ? [`Cc: ${addressList(d.cc)}`] : []),
    `Subject: ${encodeHeaderText(d.subject)}`,
    ...(d.inReplyTo ? [`In-Reply-To: ${oneLine(d.inReplyTo)}`] : []),
    ...(d.references ? [`References: ${oneLine(d.references)}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = base64Lines(d.body.replace(/\r?\n/g, CRLF));
  return Buffer.from(headers.join(CRLF) + CRLF + CRLF + body, 'utf8').toString('base64url');
}
