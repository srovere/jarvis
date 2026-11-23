import { DomainError, ThreadNotFound } from '../domain/errors';
import type { EmailAddress } from '../domain/model/email-address';
import type { MailThread, MailThreadSummary } from '../domain/model/mail';
import type { IdentityProvider } from '../domain/ports/identity';
import type { DraftRef, DraftRequest, DraftWriter, MailChange, MailReader, SyncResult } from '../domain/ports/mail';
import { ChangeLog } from './change-log';

export interface RecordedDraft extends DraftRef {
  body: string;
  cc: EmailAddress[];
}

export class InMemoryMailProvider implements MailReader, DraftWriter, IdentityProvider {
  readonly drafts: RecordedDraft[] = [];
  private readonly threads = new Map<string, MailThread>();
  private readonly log = new ChangeLog<null, MailChange>();
  private readonly accountId: string;
  private readonly own: EmailAddress[];

  constructor(opts: { accountId: string; own: EmailAddress[] }) {
    this.accountId = opts.accountId;
    this.own = opts.own;
  }

  seed(threads: MailThread[]): void {
    for (const t of threads) {
      if (t.messages.length === 0) throw new DomainError(`Thread has no messages: ${t.id}`);
      const kept = new Set(t.messages.map((m) => m.id));
      for (const old of this.threads.get(t.id)?.messages ?? []) {
        if (!kept.has(old.id)) this.log.record(null, { kind: 'delete', messageId: old.id });
      }
      this.threads.set(t.id, t);
      for (const message of t.messages) this.log.record(null, { kind: 'upsert', message });
    }
  }

  removeMessage(messageId: string): void {
    for (const t of this.threads.values()) {
      if (!t.messages.some((m) => m.id === messageId)) continue;
      const messages = t.messages.filter((m) => m.id !== messageId);
      if (messages.length === 0) this.threads.delete(t.id);
      else this.threads.set(t.id, { ...t, messages });
      this.log.record(null, { kind: 'delete', messageId });
      return;
    }
  }

  async ownAddresses(): Promise<EmailAddress[]> {
    return this.own;
  }

  async listThreads(q: { query: string; maxResults: number }): Promise<MailThreadSummary[]> {
    const needle = q.query.toLowerCase();
    return [...this.threads.values()]
      .filter((t) => needle === '' || this.matches(t, needle))
      .sort((a, b) => b.lastMessageAt.toMillis() - a.lastMessageAt.toMillis())
      .slice(0, q.maxResults)
      .map((t) => this.summarize(t));
  }

  async getThread(threadId: string): Promise<MailThread> {
    const t = this.threads.get(threadId);
    if (!t) throw new ThreadNotFound(threadId);
    return { ...t, messages: [...t.messages].sort((a, b) => a.date.toMillis() - b.date.toMillis()) };
  }

  async sync(cursor: string | null): Promise<SyncResult<MailChange>> {
    return this.log.sync(cursor, () => true, () =>
      [...this.threads.values()].flatMap((t) => t.messages.map((message): MailChange => ({ kind: 'upsert', message }))),
    );
  }

  async createDraft(r: DraftRequest): Promise<DraftRef> {
    if (!r.to?.length && !r.threadId) throw new DomainError('Draft requires recipients or a threadId');
    const thread = r.threadId ? await this.getThread(r.threadId) : undefined;
    const to = r.to?.length ? r.to : this.replyRecipients(thread!);
    const subject = r.subject ?? (thread ? this.replySubject(thread.subject) : '');
    const ref: DraftRef = { draftId: `draft-${this.drafts.length + 1}`, to, subject };
    if (r.threadId) ref.threadId = r.threadId;
    this.drafts.push({ ...ref, body: r.body, cc: r.cc ?? [] });
    return ref;
  }

  private isOwn(a: EmailAddress): boolean {
    return this.own.some((o) => o.equals(a));
  }

  private replyRecipients(thread: MailThread): EmailAddress[] {
    const last = thread.messages[thread.messages.length - 1];
    if (!last) throw new DomainError(`Thread has no messages: ${thread.id}`);
    if (!this.isOwn(last.from)) return [last.from];
    const other = last.to.find((a) => !this.isOwn(a));
    return [other ?? last.from];
  }

  private replySubject(subject: string): string {
    return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
  }

  private matches(t: MailThread, needle: string): boolean {
    const hay = [t.subject, ...t.messages.flatMap((m) => [m.snippet, m.from.address, m.from.name ?? ''])];
    return hay.some((h) => h.toLowerCase().includes(needle));
  }

  private summarize(t: MailThread): MailThreadSummary {
    const { messages, ...rest } = t;
    const sorted = [...messages].sort((a, b) => a.date.toMillis() - b.date.toMillis());
    const last = sorted[sorted.length - 1];
    const participants: EmailAddress[] = [];
    for (const a of sorted.flatMap((m) => [m.from, ...m.to, ...m.cc])) {
      if (!participants.some((p) => p.equals(a))) participants.push(a);
    }
    return { ...rest, participants, lastFrom: last!.from, snippet: last!.snippet };
  }
}
