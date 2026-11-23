import type { MailMessage, MailThread } from '@jarvis/core';
import type { gmail_v1 } from 'googleapis';
import { vi } from 'vitest';

type Message = gmail_v1.Schema$Message;
type Header = { name: string; value: string };

interface HistoryRecord {
  id: number;
  added: string[];
  deleted: string[];
  labelsAdded: string[];
  labelsRemoved: string[];
}

export interface FakeGmailOptions {
  /** sendAs addresses; the first is the primary one. */
  sendAs?: string[];
  /** Clock for `newer_than:`; defaults to `Date.now`. */
  now?: () => number;
  /** Page size of `messages.list` and `history.list` (to exercise pagination). */
  pageSize?: number;
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const apiError = (code: number): Error & { code: number } => Object.assign(new Error(`HTTP ${code}`), { code });

/** In-memory Gmail: implements the subset of `gmail_v1.Gmail` that `GmailAdapter` uses. */
export class FakeGmail {
  readonly sendSpy = vi.fn();
  readonly draftSendSpy = vi.fn();
  /** Borradores creados (`raw` decodificado a texto). */
  readonly drafts: { id: string; threadId?: string; mime: string }[] = [];
  readonly calls = {
    historyList: vi.fn(),
    messagesGet: vi.fn(),
    messagesList: vi.fn(),
    threadsGet: vi.fn(),
    threadsList: vi.fn(),
    draftsCreate: vi.fn(),
    sendAsList: vi.fn(),
  };

  private readonly messages = new Map<string, Message>();
  private readonly history: HistoryRecord[] = [];
  private historyId = 1000;
  private oldestHistoryId = 1000;
  private readonly now: () => number;
  private readonly pageSize: number;
  private readonly sendAs: string[];

  constructor(opts: FakeGmailOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.pageSize = opts.pageSize ?? 500;
    this.sendAs = opts.sendAs ?? ['me@x.com'];
  }

  /** Typed client to inject into the adapter. */
  asGmail(): gmail_v1.Gmail {
    return this.client as unknown as gmail_v1.Gmail;
  }

  // --- siembra / mutaciones --------------------------------------------------------------------

  seed(threads: MailThread[]): void {
    for (const t of threads) {
      const kept = new Set(t.messages.map((m) => m.id));
      for (const old of [...this.messages.values()]) {
        if (old.threadId === t.id && !kept.has(old.id!)) this.removeMessage(old.id!);
      }
      for (const m of t.messages) this.putMessage(this.toApiMessage(m, t.unread));
    }
  }

  removeMessage(id: string): void {
    this.messages.delete(id);
    this.record({ deleted: [id] });
  }

  /** Deletes a message without a history trace (Gmail purged it between the event and the read). */
  dropMessageSilently(id: string): void {
    this.messages.delete(id);
  }

  setLabels(id: string, labels: string[]): void {
    const m = this.messages.get(id)!;
    const before = m.labelIds ?? [];
    m.labelIds = labels;
    this.record({
      labelsAdded: labels.some((l) => !before.includes(l)) ? [id] : [],
      labelsRemoved: before.some((l) => !labels.includes(l)) ? [id] : [],
    });
  }

  /** Simulates Gmail no longer keeping history before now (404 on `history.list`). */
  expireHistory(): void {
    this.oldestHistoryId = this.historyId;
  }

  // --- cliente ---------------------------------------------------------------------------------

  private readonly client = {
    users: {
      getProfile: async () => ({ data: { emailAddress: this.sendAs[0], historyId: String(this.historyId) } }),
      threads: {
        list: async (p: { q?: string; maxResults?: number }) => {
          this.calls.threadsList(p);
          const needle = (p.q ?? '').toLowerCase();
          const threads = [...this.byThread().entries()]
            .filter(([, ms]) => needle === '' || needle.includes(':') || ms.some((m) => this.haystack(m).includes(needle)))
            .sort(([, a], [, b]) => this.latest(b) - this.latest(a))
            .slice(0, p.maxResults ?? 100)
            .map(([id]) => ({ id }));
          return { data: { threads } };
        },
        get: async (p: { id: string; format?: string; metadataHeaders?: string[] }) => {
          this.calls.threadsGet(p);
          const ms = this.byThread().get(p.id);
          if (!ms) throw apiError(404);
          return { data: { id: p.id, messages: ms.map((m) => this.shape(m, p.format, p.metadataHeaders)) } };
        },
      },
      messages: {
        list: async (p: { q?: string; pageToken?: string }) => {
          this.calls.messagesList(p);
          const days = /newer_than:(\d+)d/.exec(p.q ?? '')?.[1];
          const cutoff = days ? this.now() - Number(days) * 86_400_000 : -Infinity;
          const matching = [...this.messages.values()].filter(
            (m) => Number(m.internalDate) >= cutoff && !m.labelIds?.some((l) => l === 'TRASH' || l === 'SPAM'),
          );
          const offset = Number(p.pageToken ?? 0);
          const page = matching.slice(offset, offset + this.pageSize);
          const next = offset + this.pageSize < matching.length ? String(offset + this.pageSize) : undefined;
          return { data: { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })), nextPageToken: next } };
        },
        get: async (p: { id: string; format?: string; metadataHeaders?: string[] }) => {
          this.calls.messagesGet(p);
          const m = this.messages.get(p.id);
          if (!m) throw apiError(404);
          return { data: this.shape(m, p.format, p.metadataHeaders) };
        },
        send: this.sendSpy,
      },
      history: {
        list: async (p: { startHistoryId: string; pageToken?: string; historyTypes?: string[] }) => {
          this.calls.historyList(p);
          if (Number(p.startHistoryId) < this.oldestHistoryId) throw apiError(404);
          const pending = this.history.filter((r) => r.id > Number(p.startHistoryId));
          const offset = Number(p.pageToken ?? 0);
          const page = pending.slice(offset, offset + this.pageSize);
          const next = offset + this.pageSize < pending.length ? String(offset + this.pageSize) : undefined;
          const ref = (ids: string[], type: string) =>
            !p.historyTypes || p.historyTypes.includes(type) ? ids.map((id) => ({ message: { id, threadId: 'unknown' } })) : [];
          return {
            data: {
              historyId: String(this.historyId),
              nextPageToken: next,
              history: page.map((r) => ({
                id: String(r.id),
                messagesAdded: ref(r.added, 'messageAdded'),
                messagesDeleted: ref(r.deleted, 'messageDeleted'),
                labelsAdded: ref(r.labelsAdded, 'labelAdded'),
                labelsRemoved: ref(r.labelsRemoved, 'labelRemoved'),
              })),
            },
          };
        },
      },
      drafts: {
        create: async (p: { requestBody: { message: { raw: string; threadId?: string } } }) => {
          this.calls.draftsCreate(p);
          const { raw, threadId } = p.requestBody.message;
          const id = `draft-${this.drafts.length + 1}`;
          const mime = Buffer.from(raw, 'base64url').toString('utf8');
          this.drafts.push({ id, ...(threadId && { threadId }), mime });
          const message = this.draftMessage(`msg-${id}`, threadId ?? `thread-${id}`, mime);
          this.putMessage(message);
          return { data: { id, message: { id: message.id, threadId: message.threadId } } };
        },
        send: this.draftSendSpy,
      },
      settings: {
        sendAs: {
          list: async () => {
            this.calls.sendAsList();
            return {
            data: { sendAs: this.sendAs.map((sendAsEmail, i) => ({ sendAsEmail, isPrimary: i === 0 })) },
            };
          },
        },
      },
    },
  };

  // --- internos --------------------------------------------------------------------------------

  /** A draft shows up in `threads.get` as one more message, labelled DRAFT. */
  private draftMessage(id: string, threadId: string, mime: string): Message {
    const [head = ''] = mime.split('\r\n\r\n');
    const headers: Header[] = head
      .replace(/\r\n[ \t]+/g, ' ')
      .split('\r\n')
      .map((line) => ({ name: line.slice(0, line.indexOf(':')), value: line.slice(line.indexOf(':') + 1).trim() }));
    headers.push({ name: 'Message-ID', value: `<${id}@fake.test>` });
    return {
      id,
      threadId,
      labelIds: ['DRAFT'],
      snippet: '',
      internalDate: String(this.now()),
      payload: { mimeType: 'text/plain', headers },
    };
  }

  private putMessage(m: Message): void {
    const existed = this.messages.has(m.id!);
    this.messages.set(m.id!, m);
    this.record(existed ? { labelsAdded: [m.id!] } : { added: [m.id!] });
  }

  private record(r: Partial<Omit<HistoryRecord, 'id'>>): void {
    this.historyId += 1;
    this.history.push({ id: this.historyId, added: [], deleted: [], labelsAdded: [], labelsRemoved: [], ...r });
  }

  private byThread(): Map<string, Message[]> {
    const out = new Map<string, Message[]>();
    for (const m of this.messages.values()) out.set(m.threadId!, [...(out.get(m.threadId!) ?? []), m]);
    for (const ms of out.values()) ms.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    return out;
  }

  private latest(ms: Message[]): number {
    return Math.max(...ms.map((m) => Number(m.internalDate)));
  }

  private haystack(m: Message): string {
    const subject = m.payload?.headers?.find((h) => h.name === 'Subject')?.value ?? '';
    return `${subject} ${m.snippet ?? ''}`.toLowerCase();
  }

  /** `metadata` keeps only the requested headers and no body; `full` returns everything. */
  private shape(m: Message, format?: string, only?: string[]): Message {
    if (format !== 'metadata') return m;
    const wanted = only?.map((h) => h.toLowerCase());
    const headers = (m.payload?.headers ?? []).filter((h) => !wanted || wanted.includes(h.name!.toLowerCase()));
    return { ...m, payload: { headers } };
  }

  private toApiMessage(m: MailMessage, unread: boolean): Message {
    const headers: Header[] = [
      { name: 'From', value: m.from.toString() },
      { name: 'To', value: m.to.map(String).join(', ') },
      { name: 'Subject', value: m.subject },
      { name: 'Date', value: m.date.toRFC2822() ?? '' },
      { name: 'Message-ID', value: m.messageIdHeader ?? `<${m.id}@fake.test>` },
    ];
    if (m.cc.length > 0) headers.push({ name: 'Cc', value: m.cc.map(String).join(', ') });
    if (m.referencesHeader) headers.push({ name: 'References', value: m.referencesHeader });
    const parts: gmail_v1.Schema$MessagePart[] = [];
    if (m.bodyText !== undefined) parts.push({ mimeType: 'text/plain', body: { data: b64(m.bodyText) } });
    if (m.bodyHtml !== undefined) parts.push({ mimeType: 'text/html', body: { data: b64(m.bodyHtml) } });
    return {
      id: m.id,
      threadId: m.threadId,
      labelIds: unread ? [...m.labels, 'UNREAD'] : m.labels,
      snippet: m.snippet,
      internalDate: String(m.date.toMillis()),
      payload: {
        mimeType: parts.length > 0 ? 'multipart/alternative' : 'text/plain',
        headers,
        ...(parts.length > 0 && { parts }),
      },
    };
  }
}
