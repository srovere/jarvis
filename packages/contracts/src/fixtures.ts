import { DateTime } from 'luxon';
import { EmailAddress } from '@jarvis/core';
import type { MailMessage, MailThread } from '@jarvis/core';

export const FIXTURE_ACCOUNT_ID = 'contract-account';

/** Reference instant used by the mail fixtures. */
export const T0 = DateTime.fromISO('2026-11-23T10:00:00Z', { setZone: true });

export const addr = (raw: string): EmailAddress => EmailAddress.parse(raw);

export interface MessageSpec {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  /** Minutes after T0. */
  minutes: number;
  subject?: string;
  cc?: string[];
}

export function buildMessage(spec: MessageSpec): MailMessage {
  return {
    id: spec.id,
    threadId: spec.threadId,
    accountId: FIXTURE_ACCOUNT_ID,
    from: addr(spec.from),
    to: spec.to.map(addr),
    cc: (spec.cc ?? []).map(addr),
    subject: spec.subject ?? 'Hello',
    date: T0.plus({ minutes: spec.minutes }),
    snippet: `snippet ${spec.id}`,
    labels: ['INBOX'],
  };
}

/** Builds a thread from messages in the given order (not necessarily chronological). */
export function buildThread(id: string, subject: string, messages: MailMessage[]): MailThread {
  const latest = messages.reduce((a, b) => (b.date.toMillis() > a.date.toMillis() ? b : a));
  return {
    id,
    accountId: FIXTURE_ACCOUNT_ID,
    subject,
    messages,
    lastMessageAt: latest.date,
    unread: true,
    labels: ['INBOX'],
  };
}
