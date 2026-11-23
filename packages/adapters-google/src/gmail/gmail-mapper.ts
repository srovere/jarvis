import { DomainError, EmailAddress } from '@jarvis/core';
import type { MailMessage, MailThread, MailThreadSummary } from '@jarvis/core';
import { DateTime } from 'luxon';
import type { gmail_v1 } from 'googleapis';

type GmailMessage = gmail_v1.Schema$Message;
type GmailPart = gmail_v1.Schema$MessagePart;
type GmailThread = gmail_v1.Schema$Thread;

/** Fallback sender when the From header is missing or cannot be parsed. */
const UNKNOWN_SENDER = 'unknown@unknown.invalid';

export function headerValue(part: GmailPart | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return part?.headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? undefined;
}

function safeDecode(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function charsetOf(contentType: string | undefined): string | undefined {
  return /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '')?.[1];
}

/** Decodes RFC 2047 encoded-words (`=?charset?B|Q?...?=`) in a header. */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toLowerCase() === 'b'
          ? Buffer.from(text, 'base64')
          : Buffer.from(
              text.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
              'latin1',
            );
      return safeDecode(bytes, charset);
    });
}

/** Splits an address list on top-level commas (honouring quotes and `<...>`). */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '\\' && quoted) {
      current += ch + (value[++i] ?? '');
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angle = true;
    else if (!quoted && ch === '>') angle = false;
    if (ch === ',' && !quoted && !angle) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** Parses an address header; addresses that cannot be parsed are skipped. */
export function parseAddressHeader(value: string | undefined): EmailAddress[] {
  const out: EmailAddress[] = [];
  for (const piece of splitAddressList(value ?? '')) {
    try {
      out.push(EmailAddress.parse(decodeMimeWords(piece)));
    } catch {
      // unreadable address: skipped without logging its content
    }
  }
  return out;
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType?.toLowerCase() === mimeType && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

function decodePart(part: GmailPart | undefined): string | undefined {
  if (!part?.body?.data) return undefined;
  return safeDecode(Buffer.from(part.body.data, 'base64url'), charsetOf(headerValue(part, 'Content-Type')));
}

/** Maps Gmail API objects to the domain model. */
export class GmailMapper {
  constructor(private readonly accountId: string) {}

  toMessage(m: GmailMessage): MailMessage {
    if (!m.id || !m.threadId) throw new DomainError('Gmail message without id/threadId');
    const payload = m.payload ?? undefined;
    const header = (name: string): string | undefined => headerValue(payload, name);
    const message: MailMessage = {
      id: m.id,
      threadId: m.threadId,
      accountId: this.accountId,
      from: parseAddressHeader(header('From'))[0] ?? EmailAddress.parse(UNKNOWN_SENDER),
      to: parseAddressHeader(header('To')),
      cc: parseAddressHeader(header('Cc')),
      subject: decodeMimeWords(header('Subject') ?? ''),
      date: this.dateOf(m, header('Date')),
      snippet: m.snippet ?? '',
      labels: m.labelIds ?? [],
      raw: { id: m.id, threadId: m.threadId, labelIds: m.labelIds, historyId: m.historyId, internalDate: m.internalDate },
    };
    const messageId = header('Message-ID');
    if (messageId) message.messageIdHeader = messageId;
    const references = header('References');
    if (references) message.referencesHeader = references;
    if (payload) {
      const text = decodePart(findPart(payload, 'text/plain'));
      if (text !== undefined) message.bodyText = text;
      const html = decodePart(findPart(payload, 'text/html'));
      if (html !== undefined) message.bodyHtml = html;
    }
    return message;
  }

  toThread(t: GmailThread): MailThread {
    const messages = this.sortedMessages(t);
    return {
      id: t.id!,
      accountId: this.accountId,
      subject: messages[0]!.subject,
      messages,
      lastMessageAt: messages[messages.length - 1]!.date,
      unread: messages.some((m) => m.labels.includes('UNREAD')),
      labels: [...new Set(messages.flatMap((m) => m.labels))],
    };
  }

  toSummary(t: GmailThread): MailThreadSummary {
    const { messages, ...rest } = this.toThread(t);
    const last = messages[messages.length - 1]!;
    const participants: EmailAddress[] = [];
    for (const a of messages.flatMap((m) => [m.from, ...m.to, ...m.cc])) {
      if (!participants.some((p) => p.equals(a))) participants.push(a);
    }
    return { ...rest, participants, lastFrom: last.from, snippet: last.snippet };
  }

  private sortedMessages(t: GmailThread): MailMessage[] {
    if (!t.id || !t.messages || t.messages.length === 0) throw new DomainError(`Thread has no messages: ${t.id}`);
    return t.messages.map((m) => this.toMessage(m)).sort((a, b) => a.date.toMillis() - b.date.toMillis());
  }

  private dateOf(m: GmailMessage, dateHeader: string | undefined): DateTime {
    if (m.internalDate) return DateTime.fromMillis(Number(m.internalDate), { zone: 'utc' });
    const parsed = DateTime.fromRFC2822(dateHeader ?? '', { zone: 'utc' });
    return parsed.isValid ? parsed : DateTime.fromMillis(0, { zone: 'utc' });
  }
}
