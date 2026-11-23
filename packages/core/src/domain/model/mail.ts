import type { DateTime } from 'luxon';
import type { EmailAddress } from './email-address';

export interface MailMessage {
  id: string;
  threadId: string;
  accountId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: DateTime;
  snippet: string;
  labels: string[];
  messageIdHeader?: string;
  referencesHeader?: string;
  bodyText?: string;
  bodyHtml?: string;
  raw?: unknown;
}

export interface MailThread {
  id: string;
  accountId: string;
  subject: string;
  messages: MailMessage[];
  lastMessageAt: DateTime;
  unread: boolean;
  labels: string[];
}

export type MailThreadSummary = Omit<MailThread, 'messages'> & {
  participants: EmailAddress[];
  lastFrom: EmailAddress;
  snippet: string;
};
