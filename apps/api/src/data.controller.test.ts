import 'reflect-metadata';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB, EFFECTIVE_PREFERENCES } from '@jarvis/composition';
import { JarvisConfigSchema } from '@jarvis/config';
import { EmailAddress, ProviderRegistry, TimeRange, TOKENS, type CalendarEvent, type MailMessage, type ProviderBundle, type Task } from '@jarvis/core';
import {
  FixedClock,
  InMemoryCalendarProvider,
  InMemoryMailProvider,
  InMemoryRepositories,
  InMemorySettingsStore,
  InMemorySyncRequests,
  InMemoryTasksProvider,
} from '@jarvis/core/testing';
import type { INestApplication } from '@nestjs/common';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule as McpAppModule } from '../../mcp-server/src/app.module';
import { API_APP_OPTIONS, AppModule } from './app.module';
import { DATA_CONTROLLERS } from './data.controller';
import { McpClientService } from './mcp-client.service';

const ZONE = 'America/Argentina/Buenos_Aires';
const TOKEN = 'data-test-token-0123456789';
const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });
/** Monday 2026-11-23, 08:00 in Buenos Aires; work hours default to 9-19. */
const NOW = at('2026-11-23T08:00:00');

interface Reply {
  status: number;
  json: any;
}

function send(port: number, method: string, path: string, body?: unknown, raw?: string): Promise<Reply> {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { host: '127.0.0.1:3000', ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) } },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function message(id: string, threadId: string, subject: string, date: DateTime): MailMessage {
  return {
    id,
    threadId,
    accountId: 'personal',
    from: EmailAddress.parse('Ana <ana@client.com>'),
    to: [EmailAddress.parse('me@example.com')],
    cc: [],
    subject,
    date,
    snippet: 'Shall we review the budget?',
    labels: ['INBOX', 'UNREAD'],
    bodyText: 'Hi, shall we review the budget tomorrow?',
  };
}

describe('data endpoints (API -> MCP client -> in-process mcp-server)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-api-data-'));
  let mcpApp: INestApplication;
  let apiApp: INestApplication;
  let port: number;
  let repos: InMemoryRepositories;
  let syncRequests: InMemorySyncRequests;
  /** Every tool call the API made, to assert that invalid requests never reach MCP. */
  const calls: unknown[][] = [];

  beforeEach(() => {
    calls.length = 0;
  });

  beforeAll(async () => {
    writeFileSync(join(dir, 'mcp_token'), `${TOKEN}\n`);
    const config = JarvisConfigSchema.parse({ timezone: ZONE, mcp: { tokenFile: 'mcp_token' } });
    const clock = new FixedClock(NOW);
    repos = new InMemoryRepositories();
    syncRequests = new InMemorySyncRequests();
    const own = EmailAddress.parse('me@example.com');
    await repos.accounts.upsert({ id: 'personal', provider: 'google', email: own, status: 'active', busyCalendars: ['primary'], missingScopes: [], createdVia: 'config' });

    const budget = message('m1', 't1', 'Budget 2027', NOW.minus({ hours: 2 }));
    const mail = new InMemoryMailProvider({ accountId: 'personal', own: [own] });
    mail.seed([{ id: 't1', accountId: 'personal', subject: budget.subject, messages: [budget], lastMessageAt: budget.date, unread: true, labels: ['INBOX'] }]);
    await repos.mail.applyChanges('personal', [{ kind: 'upsert', message: budget }]);

    const standup: CalendarEvent = {
      id: 'e1',
      accountId: 'personal',
      calendarId: 'primary',
      title: 'Standup',
      range: new TimeRange(at('2026-11-23T10:00:00'), at('2026-11-23T10:30:00')),
      allDay: false,
      blocksTime: true,
      attendees: [],
      status: 'confirmed',
    };
    const calendar = new InMemoryCalendarProvider({ accountId: 'personal' });
    calendar.seedCalendars([{ id: 'me@example.com', title: 'Me', primary: true }]);
    calendar.seed([standup]);
    await repos.events.applyChanges('personal', [{ kind: 'upsert', event: standup }]);

    const list = { id: 'l1', accountId: 'personal', title: 'My tasks', isDefault: true };
    const report: Task = { id: 'k1', accountId: 'personal', listId: 'l1', title: 'Send report', status: 'open', due: at('2026-11-23T00:00:00'), updatedAt: NOW, deleted: false };
    const tasks = new InMemoryTasksProvider({ accountId: 'personal', clock });
    tasks.seed([list], [report]);
    await repos.tasks.upsertLists('personal', [list]);
    await repos.tasks.applyChanges('personal', 'l1', [{ kind: 'upsert', task: report }]);

    // A second active account whose only thread is older than everything in the first one, and one task.
    await repos.accounts.upsert({ id: 'work', provider: 'google', email: EmailAddress.parse('work@example.com'), status: 'active', busyCalendars: ['primary'], missingScopes: [], createdVia: 'config' });
    const old: MailMessage = { ...message('w1', 'tw', 'Old budget', NOW.minus({ days: 20 })), accountId: 'work' };
    const workMail = new InMemoryMailProvider({ accountId: 'work', own: [EmailAddress.parse('work@example.com')] });
    workMail.seed([{ id: 'tw', accountId: 'work', subject: old.subject, messages: [old], lastMessageAt: old.date, unread: false, labels: ['INBOX'] }]);
    const workList = { id: 'wl', accountId: 'work', title: 'Work tasks', isDefault: true };
    const workTask: Task = { id: 'wk1', accountId: 'work', listId: 'wl', title: 'Work item', status: 'open', updatedAt: NOW, deleted: false };
    const workTasks = new InMemoryTasksProvider({ accountId: 'work', clock });
    workTasks.seed([workList], [workTask]);
    await repos.tasks.upsertLists('work', [workList]);
    await repos.tasks.applyChanges('work', 'wl', [{ kind: 'upsert', task: workTask }]);
    const workBundle: ProviderBundle = {
      mail: workMail,
      calendar: new InMemoryCalendarProvider({ accountId: 'work' }),
      tasks: workTasks,
      identity: workMail,
      capabilities: { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true },
    };

    const bundle: ProviderBundle = {
      mail,
      calendar,
      tasks,
      identity: mail,
      capabilities: { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true },
    };
    const registry = new ProviderRegistry();
    registry.register({ kind: 'google', create: async (a: { id: string }) => (a.id === 'work' ? workBundle : bundle) });

    const mcpModule = await Test.createTestingModule({
      imports: [McpAppModule.forRoot({ config, configDir: dir, databaseUrl: 'postgres://unused/db' })],
    })
      .overrideProvider(DB)
      .useValue({ $client: { end: async () => undefined } })
      .overrideProvider(TOKENS.AccountRepository)
      .useValue(repos.accounts)
      .overrideProvider(TOKENS.SettingsStore)
      .useValue(new InMemorySettingsStore())
      .overrideProvider(TOKENS.SyncRequests)
      .useValue(syncRequests)
      .overrideProvider(TOKENS.SyncStateRepository)
      .useValue(repos.syncState)
      .overrideProvider(TOKENS.MailRepository)
      .useValue(repos.mail)
      .overrideProvider(TOKENS.EventRepository)
      .useValue(repos.events)
      .overrideProvider(TOKENS.TaskRepository)
      .useValue(repos.tasks)
      .overrideProvider(TOKENS.PersonLinkLookup)
      .useValue(repos.personLinks)
      .overrideProvider(TOKENS.ProviderRegistry)
      .useValue(registry)
      .overrideProvider(TOKENS.Clock)
      .useValue(clock)
      .compile();
    mcpApp = mcpModule.createNestApplication();
    await mcpApp.listen(0, '127.0.0.1');
    const mcpUrl = `${await mcpApp.getUrl()}/mcp`.replace('[::1]', '127.0.0.1');

    const apiModule = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: JarvisConfigSchema.parse({}),
          configDir: '/nonexistent',
          databaseUrl: 'postgres://unused/db',
          configPresent: false,
          webDist: join(tmpdir(), 'jarvis-no-such-dist'),
          mcp: { url: mcpUrl, tokenFile: join(dir, 'mcp_token') },
        }),
      ],
    })
      .overrideProvider(AbstractLoader)
      .useValue(new ExpressLoader())
      .overrideProvider(DB)
      .useValue({ $client: { end: async () => undefined } })
      .overrideProvider(TOKENS.AccountRepository)
      .useValue(repos.accounts)
      .overrideProvider(TOKENS.SettingsStore)
      .useValue(new InMemorySettingsStore())
      .overrideProvider(EFFECTIVE_PREFERENCES)
      .useFactory({ factory: () => ({ load: async () => { throw new Error('unused'); } }) })
      .compile();
    const mcpClient = apiModule.get(McpClientService);
    const realCall = mcpClient.call.bind(mcpClient);
    mcpClient.call = ((tool: string, args?: object) => {
      calls.push([tool, args]);
      return realCall(tool, args);
    }) as typeof mcpClient.call;
    apiApp = apiModule.createNestApplication(API_APP_OPTIONS);
    await apiApp.listen(0, '127.0.0.1');
    port = Number(new URL(await apiApp.getUrl()).port);
  });

  afterAll(async () => {
    await apiApp.close();
    await mcpApp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /api/today', () => {
    it('returns the cards, events, emails and tasks of the day', async () => {
      const r = await send(port, 'GET', '/api/today');
      expect(r.status).toBe(200);
      expect(r.json.date).toBe('2026-11-23');
      expect(r.json.cards).toEqual({ meetings: 1, freeMinutes: 570, priorityEmails: 1, tasksDue: 1 });
      expect(r.json.events.map((e: { id: string }) => e.id)).toEqual(['e1']);
      expect(r.json.emails.map((e: { threadId: string }) => e.threadId)).toEqual(['t1']);
      expect(r.json.emails[0].subject).toContain('<external_content source="email">Budget 2027');
      expect(r.json.tasks.map((t: { id: string }) => t.id)).toEqual(['k1']);
      expect(r.json).not.toHaveProperty('freeMinutes');
    });
  });

  describe('mail', () => {
    it('searches emails, building the Gmail query from the filters, and keeps accountId', async () => {
      const r = await send(port, 'GET', '/api/mail/search?q=budget');
      expect(r.status).toBe(200);
      expect(r.json.emails.map((e: { accountId: string }) => e.accountId).sort()).toEqual(['personal', 'work']);
    });

    it('filters by accountId', async () => {
      const work = await send(port, 'GET', '/api/mail/search?q=budget&accountId=work');
      expect(work.status).toBe(200);
      expect(work.json.emails.map((e: { threadId: string }) => e.threadId)).toEqual(['tw']);
      expect(calls[0]).toEqual(['search_emails', { query: 'budget', max_results: 20, account_id: 'work' }]);
      const all = await send(port, 'GET', '/api/mail/search?q=budget');
      expect(all.json.emails.map((e: { threadId: string }) => e.threadId).sort()).toEqual(['t1', 'tw']);
    });

    it('rejects a search with no criteria or a bad date without calling MCP', async () => {
      expect((await send(port, 'GET', '/api/mail/search')).status).toBe(400);
      const bad = await send(port, 'GET', '/api/mail/search?q=x&after=yesterday');
      expect(bad.status).toBe(400);
      expect(typeof bad.json.error).toBe('string');
      expect(calls).toEqual([]);
    });

    it('reads a thread', async () => {
      const r = await send(port, 'GET', '/api/mail/threads/personal/t1');
      expect(r.status).toBe(200);
      expect(r.json.threadId).toBe('t1');
      expect(r.json.messages).toHaveLength(1);
    });

    it('maps a tool error to 502 with its message', async () => {
      const r = await send(port, 'GET', '/api/mail/threads/personal/nope');
      expect(r.status).toBe(502);
      expect(typeof r.json.error).toBe('string');
      expect(r.json.error.length).toBeGreaterThan(0);
    });

    it('creates a draft (never sends)', async () => {
      const r = await send(port, 'POST', '/api/mail/drafts', { to: ['ana@client.com'], subject: 'Hi', body: 'Hello' });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ to: ['ana@client.com'], subject: 'Hi' });
      expect(typeof r.json.draftId).toBe('string');
    });

    it('rejects an invalid draft body with 400', async () => {
      expect((await send(port, 'POST', '/api/mail/drafts', { to: ['a@b.com'] })).status).toBe(400);
      expect((await send(port, 'POST', '/api/mail/drafts', { body: 'x' })).status).toBe(400);
      expect((await send(port, 'POST', '/api/mail/drafts', { body: 'x', to: 'a@b.com' })).status).toBe(400);
      expect(calls).toEqual([]);
    });
  });

  describe('calendar', () => {
    it('lists events with from/to passed through (to is exclusive)', async () => {
      const day = await send(port, 'GET', '/api/calendar/events?from=2026-11-23&to=2026-11-24');
      expect(day.status).toBe(200);
      expect(day.json.events.map((e: { id: string }) => e.id)).toEqual(['e1']);
      const empty = await send(port, 'GET', '/api/calendar/events?from=2026-11-23&to=2026-11-23');
      expect(empty.json).toEqual({ events: [] });
    });

    it('rejects a malformed date with 400', async () => {
      expect((await send(port, 'GET', '/api/calendar/events?from=tomorrow')).status).toBe(400);
    });

    it('lists calendars', async () => {
      const r = await send(port, 'GET', '/api/calendar/calendars');
      expect(r.status).toBe(200);
      expect(r.json.calendars[0]).toMatchObject({ id: 'me@example.com', accountId: 'personal', primary: true });
    });

    it('finds a free slot and validates the body', async () => {
      const r = await send(port, 'POST', '/api/calendar/free-slot', { durationMinutes: 60 });
      expect(r.status).toBe(200);
      expect(r.json.slot.start).toBe('2026-11-23T09:00:00.000-03:00');
      expect((await send(port, 'POST', '/api/calendar/free-slot', { durationMinutes: 5 })).status).toBe(400);
    });

    it('blocks focus time and requires a task name', async () => {
      const r = await send(port, 'POST', '/api/calendar/focus', { taskName: 'Write spec', durationMinutes: 60 });
      expect(r.status).toBe(200);
      expect(r.json.status).toBe('created');
      expect((await send(port, 'POST', '/api/calendar/focus', { durationMinutes: 60 })).status).toBe(400);
    });
  });

  describe('tasks', () => {
    it('lists tasks by status and rejects an unknown one', async () => {
      const open = await send(port, 'GET', '/api/tasks');
      expect(open.status).toBe(200);
      expect(open.json.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['k1', 'wk1']);
      expect((await send(port, 'GET', '/api/tasks?status=completed')).json).toEqual({ tasks: [] });
      expect((await send(port, 'GET', '/api/tasks?status=bogus')).status).toBe(400);
    });

    it('lists task lists', async () => {
      const r = await send(port, 'GET', '/api/tasks/lists');
      expect(r.status).toBe(200);
      expect(r.json.lists[0]).toMatchObject({ id: 'l1', accountId: 'personal' });
    });

    it('creates a task and validates the body', async () => {
      const r = await send(port, 'POST', '/api/tasks', { title: 'Call Ana', due: '2026-11-25' });
      expect(r.status).toBe(201);
      expect(r.json.title).toBe('Call Ana');
      expect((await send(port, 'POST', '/api/tasks', { due: '2026-11-25' })).status).toBe(400);
      expect((await send(port, 'POST', '/api/tasks', { title: '' })).status).toBe(400);
      expect((await send(port, 'POST', '/api/tasks', { title: 'x', due: 'soon' })).status).toBe(400);
    });

    it('creates a task in the selected account', async () => {
      const r = await send(port, 'POST', '/api/tasks', { title: 'Work thing', accountId: 'work' });
      expect(r.status).toBe(201);
      expect(r.json.list).toBe('Work tasks');
    });

    it('completes a task of the second account', async () => {
      const r = await send(port, 'POST', '/api/tasks/work/wk1/complete', {});
      expect(r.status).toBe(200);
      expect(r.json.id).toBe('wk1');
      expect(calls[0]).toEqual(['complete_task', { task_id: 'wk1', account_id: 'work' }]);
    });

    it('completes a task', async () => {
      const r = await send(port, 'POST', '/api/tasks/personal/k1/complete', {});
      expect(r.status).toBe(200);
      expect(r.json.id).toBe('k1');
    });
  });

  describe('sync', () => {
    it('reports the status of the accounts', async () => {
      const r = await send(port, 'GET', '/api/sync');
      expect(r.status).toBe(200);
      expect(r.json.accounts[0]).toMatchObject({ accountId: 'personal', status: 'active' });
    });

    it('requests a sync of all accounts or of one', async () => {
      const all = await send(port, 'POST', '/api/sync', {});
      expect(all.status).toBe(200);
      expect(all.json).toEqual({ requested: ['personal', 'work'] });
      const one = await send(port, 'POST', '/api/sync', { accountId: 'personal' });
      expect(one.json).toEqual({ requested: ['personal'] });
    });
  });

  it('malformed JSON on a data POST is a 400', async () => {
    expect((await send(port, 'POST', '/api/tasks', undefined, '{oops')).status).toBe(400);
  });

  it('exposes no route with "send" in its path', () => {
    const paths: string[] = [];
    for (const controller of DATA_CONTROLLERS) {
      const base = String(Reflect.getMetadata('path', controller));
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const sub = Reflect.getMetadata('path', handler);
        if (sub !== undefined) paths.push(`${base}/${String(sub)}`);
      }
    }
    expect(paths.length).toBeGreaterThanOrEqual(15);
    expect(paths.filter((p) => /send/i.test(p))).toEqual([]);
  });
});
