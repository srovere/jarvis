import type { EmailAddress } from '../model/email-address';
import type { MailMessage, MailThread, MailThreadSummary } from '../model/mail';

export interface SyncResult<C> {
  changes: C[];
  nextCursor: string;
  fullResync: boolean;
}

export type MailChange = { kind: 'upsert'; message: MailMessage } | { kind: 'delete'; messageId: string };

export interface MailReader {
  listThreads(q: { query: string; maxResults: number }): Promise<MailThreadSummary[]>;
  getThread(threadId: string): Promise<MailThread>;
  sync(cursor: string | null, opts: { initialWindowDays: number }): Promise<SyncResult<MailChange>>;
}

export interface DraftRequest {
  to?: EmailAddress[];
  cc?: EmailAddress[];
  subject?: string;
  body: string;
  threadId?: string;
}

export interface DraftRef {
  draftId: string;
  threadId?: string;
  to: EmailAddress[];
  subject: string;
}

export interface DraftWriter {
  createDraft(r: DraftRequest): Promise<DraftRef>;
}
