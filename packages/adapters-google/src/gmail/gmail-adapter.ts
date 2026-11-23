import { DomainError, EmailAddress, ReauthRequired } from '@jarvis/core';
import type {
  DraftRef,
  DraftRequest,
  DraftWriter,
  IdentityProvider,
  MailChange,
  MailMessage,
  MailReader,
  MailThread,
  MailThreadSummary,
  SyncResult,
} from '@jarvis/core';
import type { gmail_v1 } from 'googleapis';
import { GmailMapper } from './gmail-mapper';
import { buildMime } from './mime-builder';

const USER = 'me';
const LIST_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];
const SYNC_HEADERS = [...LIST_HEADERS, 'Message-ID', 'References'];
const HISTORY_TYPES = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'];
const FETCH_BATCH = 10;

interface ApiError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: { error?: unknown } };
}

const asApiError = (e: unknown): ApiError => (typeof e === 'object' && e !== null ? (e as ApiError) : {});

function isNotFound(e: unknown): boolean {
  const err = asApiError(e);
  return err.code === 404 || err.status === 404 || err.response?.status === 404;
}

function isInvalidGrant(e: unknown): boolean {
  const err = asApiError(e);
  return err.response?.data?.error === 'invalid_grant' || err.code === 'invalid_grant' || err.message === 'invalid_grant';
}

/**
 * Gmail como `MailReader`, `DraftWriter` e `IdentityProvider`.
 * Sólo crea borradores (`drafts.create`); nunca envía correo.
 */
export class GmailAdapter implements MailReader, DraftWriter, IdentityProvider {
  private readonly mapper: GmailMapper;
  private sendAs?: Promise<gmail_v1.Schema$SendAs[]>;

  constructor(
    private readonly gmail: gmail_v1.Gmail,
    private readonly accountId: string,
  ) {
    this.mapper = new GmailMapper(accountId);
  }

  async ownAddresses(): Promise<EmailAddress[]> {
    return (await this.sendAsList()).flatMap((s) => this.tryParse(s.sendAsEmail));
  }

  async listThreads(q: { query: string; maxResults: number }): Promise<MailThreadSummary[]> {
    const list = await this.call(() => this.gmail.users.threads.list({ userId: USER, q: q.query, maxResults: q.maxResults }));
    const ids = (list.threads ?? []).flatMap((t) => (t.id ? [t.id] : []));
    const threads = await this.inBatches(ids, (id) => this.fetchThread(id, 'metadata', LIST_HEADERS));
    return threads.map((t) => this.mapper.toSummary(t));
  }

  async getThread(threadId: string): Promise<MailThread> {
    try {
      return this.mapper.toThread(await this.fetchThread(threadId, 'full'));
    } catch (e) {
      if (isNotFound(e)) throw new DomainError(`Thread not found: ${threadId}`);
      throw e;
    }
  }

  async sync(cursor: string | null, opts: { initialWindowDays: number }): Promise<SyncResult<MailChange>> {
    if (cursor === null) return this.fullSync(opts.initialWindowDays);
    return (await this.incrementalSync(cursor)) ?? this.fullSync(opts.initialWindowDays);
  }

  async createDraft(r: DraftRequest): Promise<DraftRef> {
    if (!r.to?.length && !r.threadId) throw new DomainError('Draft requires recipients or a threadId');
    const own = await this.ownAddresses();
    const last = r.threadId ? await this.lastMessageOf(r.threadId) : undefined;
    const to = r.to?.length ? r.to : this.replyRecipients(last!, own);
    const subject = r.subject ?? (last ? this.replySubject(last.subject) : '');
    const raw = buildMime({
      from: await this.fromAddress(own),
      to,
      cc: r.cc ?? [],
      subject,
      body: r.body,
      ...(last?.messageIdHeader && {
        inReplyTo: last.messageIdHeader,
        references: [last.referencesHeader, last.messageIdHeader].filter(Boolean).join(' '),
      }),
    });
    const message: gmail_v1.Schema$Message = { raw, ...(r.threadId && { threadId: r.threadId }) };
    const draft = await this.call(() => this.gmail.users.drafts.create({ userId: USER, requestBody: { message } }));
    if (!draft.id) throw new DomainError('Gmail returned a draft without id');
    const ref: DraftRef = { draftId: draft.id, to, subject };
    const threadId = draft.message?.threadId ?? r.threadId;
    if (threadId) ref.threadId = threadId;
    return ref;
  }

  // --- sincronización -------------------------------------------------------------------------

  private async fullSync(windowDays: number): Promise<SyncResult<MailChange>> {
    const nextCursor = await this.currentHistoryId();
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const token = pageToken;
      const page = await this.call(() =>
        this.gmail.users.messages.list({ userId: USER, q: `newer_than:${windowDays}d`, maxResults: 500, pageToken: token }),
      );
      ids.push(...(page.messages ?? []).flatMap((m) => (m.id ? [m.id] : [])));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    const changes = await this.upserts(ids);
    return { changes, nextCursor, fullResync: true };
  }

  /** `null` cuando Gmail ya no conserva el historial desde ese cursor (404). */
  private async incrementalSync(cursor: string): Promise<SyncResult<MailChange> | null> {
    const latest = new Map<string, 'upsert' | 'delete'>();
    let nextCursor = cursor;
    let pageToken: string | undefined;
    try {
      do {
        const token = pageToken;
        const page = await this.call(() =>
          this.gmail.users.history.list({ userId: USER, startHistoryId: cursor, historyTypes: HISTORY_TYPES, pageToken: token }),
        );
        for (const record of page.history ?? []) this.applyRecord(record, latest);
        if (page.historyId) nextCursor = page.historyId;
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
    const upsertIds = [...latest].filter(([, kind]) => kind === 'upsert').map(([id]) => id);
    const changes: MailChange[] = [...latest]
      .filter(([, kind]) => kind === 'delete')
      .map(([messageId]) => ({ kind: 'delete', messageId }));
    changes.push(...(await this.upserts(upsertIds, changes)));
    return { changes, nextCursor, fullResync: false };
  }

  /** El último evento de cada mensaje gana. */
  private applyRecord(record: gmail_v1.Schema$History, latest: Map<string, 'upsert' | 'delete'>): void {
    const mark = (list: { message?: gmail_v1.Schema$Message }[] | undefined, kind: 'upsert' | 'delete'): void => {
      for (const { message } of list ?? []) if (message?.id) latest.set(message.id, kind);
    };
    mark(record.messagesAdded, 'upsert');
    mark(record.labelsAdded, 'upsert');
    mark(record.labelsRemoved, 'upsert');
    mark(record.messagesDeleted, 'delete');
  }

  /** Descarga metadatos y produce upserts; los mensajes que ya no existen se omiten (o se vuelven delete si se pasa `deletes`). */
  private async upserts(ids: string[], deletes?: MailChange[]): Promise<MailChange[]> {
    const fetched = await this.inBatches(ids, async (id) => ({ id, message: await this.fetchMessage(id) }));
    const out: MailChange[] = [];
    for (const { id, message } of fetched) {
      if (message) out.push({ kind: 'upsert', message: this.mapper.toMessage(message) });
      else deletes?.push({ kind: 'delete', messageId: id });
    }
    return out;
  }

  private async currentHistoryId(): Promise<string> {
    const profile = await this.call(() => this.gmail.users.getProfile({ userId: USER }));
    if (!profile.historyId) throw new DomainError('Gmail profile without historyId');
    return profile.historyId;
  }

  // --- acceso a la API ------------------------------------------------------------------------

  private async fetchMessage(id: string): Promise<gmail_v1.Schema$Message | null> {
    try {
      return await this.call(() =>
        this.gmail.users.messages.get({ userId: USER, id, format: 'metadata', metadataHeaders: SYNC_HEADERS }),
      );
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  private fetchThread(id: string, format: 'metadata' | 'full', headers?: string[]): Promise<gmail_v1.Schema$Thread> {
    return this.call(() =>
      this.gmail.users.threads.get({ userId: USER, id, format, ...(headers && { metadataHeaders: headers }) }),
    );
  }

  private async lastMessageOf(threadId: string): Promise<MailMessage> {
    let thread: MailThread;
    try {
      thread = this.mapper.toThread(await this.fetchThread(threadId, 'metadata', SYNC_HEADERS));
    } catch (e) {
      if (isNotFound(e)) throw new DomainError(`Thread not found: ${threadId}`);
      throw e;
    }
    return thread.messages[thread.messages.length - 1]!;
  }

  private sendAsList(): Promise<gmail_v1.Schema$SendAs[]> {
    this.sendAs ??= this.call(() => this.gmail.users.settings.sendAs.list({ userId: USER })).then(
      (r) => r.sendAs ?? [],
      (e: unknown) => {
        this.sendAs = undefined;
        throw e;
      },
    );
    return this.sendAs;
  }

  /** Desenvuelve `data` y traduce `invalid_grant` a `ReauthRequired`; el resto de errores se propaga. */
  private async call<T>(request: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await request()).data;
    } catch (e) {
      if (isInvalidGrant(e)) throw new ReauthRequired(this.accountId);
      throw e;
    }
  }

  private async inBatches<I, O>(items: I[], fn: (item: I) => Promise<O>): Promise<O[]> {
    const out: O[] = [];
    for (let i = 0; i < items.length; i += FETCH_BATCH) {
      out.push(...(await Promise.all(items.slice(i, i + FETCH_BATCH).map(fn))));
    }
    return out;
  }

  // --- borradores -----------------------------------------------------------------------------

  private async fromAddress(own: EmailAddress[]): Promise<EmailAddress> {
    const list = await this.sendAsList();
    const primary = list.find((s) => s.isPrimary)?.sendAsEmail;
    const from = this.tryParse(primary)[0] ?? own[0];
    if (!from) throw new DomainError('Account has no sendAs address');
    return from;
  }

  private tryParse(raw: string | null | undefined): EmailAddress[] {
    if (!raw) return [];
    try {
      return [EmailAddress.parse(raw)];
    } catch {
      return [];
    }
  }

  private replyRecipients(last: MailMessage, own: EmailAddress[]): EmailAddress[] {
    const isOwn = (a: EmailAddress): boolean => own.some((o) => o.equals(a));
    if (!isOwn(last.from)) return [last.from];
    return [last.to.find((a) => !isOwn(a)) ?? last.from];
  }

  private replySubject(subject: string): string {
    return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
  }
}
