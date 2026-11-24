import { DateTime } from 'luxon';
import type { Account } from '../../domain/model/account';
import type { CalendarEvent } from '../../domain/model/calendar';
import { EmailAddress } from '../../domain/model/email-address';
import type { MailMessage, MailThread } from '../../domain/model/mail';
import type { Task } from '../../domain/model/tasks';
import { TimeRange } from '../../domain/model/time-range';
import type { ProviderBundle } from '../../domain/ports/provider';
import { EmailCleaner } from '../../domain/services/email-cleaner';
import { FixedClock } from '../../testing/fixed-clock';
import { InMemoryCalendarProvider } from '../../testing/in-memory-calendar-provider';
import { InMemoryMailProvider } from '../../testing/in-memory-mail-provider';
import { InMemoryRepositories } from '../../testing/in-memory-repositories';
import { InMemoryTasksProvider } from '../../testing/in-memory-tasks-provider';
import type { AppSettings } from '../config';
import { ProviderRegistry } from '../provider-registry';

export const ZONE = 'America/Argentina/Buenos_Aires';
export const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });
/** Monday 2026-11-23 20:00 in Buenos Aires. */
export const MONDAY_20 = at('2026-11-23T20:00:00');

export function appSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    zone: ZONE,
    workSchedule: { zone: ZONE, startHour: 9, endHour: 19, workDays: [1, 2, 3, 4, 5] },
    focus: { titlePrefix: '[Focus] ', horizonWorkDays: 5, defaultDurationMinutes: 90 },
    sync: { gmailInitialWindowDays: 90 },
    briefing: { maxPriorityEmails: 10 },
    busyCalendars: {},
    ...overrides,
  };
}

export interface AccountProviders {
  mail: InMemoryMailProvider;
  calendar: InMemoryCalendarProvider;
  tasks: InMemoryTasksProvider;
  bundle: ProviderBundle;
}

/** In-memory world: repositories, clock, a registry whose bundles are per-account in-memory providers. */
export class UseCaseFixture {
  readonly clock = new FixedClock(MONDAY_20);
  readonly repos = new InMemoryRepositories();
  readonly registry = new ProviderRegistry();
  readonly cleaner = new EmailCleaner({ htmlToText: (h) => h.replace(/<[^>]+>/g, '') });
  readonly providers = new Map<string, AccountProviders>();

  constructor() {
    this.registry.register({ kind: 'google', create: async (a: Account) => this.providers.get(a.id)!.bundle });
  }

  async addAccount(id: string, status: Account['status'] = 'active'): Promise<AccountProviders> {
    const email = EmailAddress.parse(`${id}@example.com`);
    await this.repos.accounts.upsert({ id, provider: 'google', email, status });
    const mail = new InMemoryMailProvider({ accountId: id, own: [email] });
    const calendar = new InMemoryCalendarProvider({ accountId: id });
    const tasks = new InMemoryTasksProvider({ accountId: id, clock: this.clock });
    const bundle: ProviderBundle = {
      mail,
      calendar,
      tasks,
      identity: mail,
      capabilities: { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true },
    };
    const p = { mail, calendar, tasks, bundle };
    this.providers.set(id, p);
    return p;
  }
}

export function message(id: string, threadId: string, accountId: string, date: DateTime, extra: Partial<MailMessage> = {}): MailMessage {
  return {
    id,
    threadId,
    accountId,
    from: EmailAddress.parse('Ana <ana@client.com>'),
    to: [EmailAddress.parse(`${accountId}@example.com`)],
    cc: [],
    subject: `Subject ${threadId}`,
    date,
    snippet: `snippet ${id}`,
    labels: ['INBOX', 'UNREAD'],
    ...extra,
  };
}

export function thread(messages: MailMessage[]): MailThread {
  const first = messages[0]!;
  return {
    id: first.threadId,
    accountId: first.accountId,
    subject: first.subject,
    messages,
    lastMessageAt: messages[messages.length - 1]!.date,
    unread: true,
    labels: ['INBOX'],
  };
}

export function event(id: string, accountId: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    accountId,
    calendarId: 'primary',
    title: `Event ${id}`,
    range: new TimeRange(at(start), at(end)),
    allDay: false,
    blocksTime: true,
    attendees: [],
    status: 'confirmed',
    ...extra,
  };
}

export function task(id: string, accountId: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    accountId,
    listId: 'l1',
    title: `Task ${id}`,
    status: 'open',
    updatedAt: MONDAY_20,
    deleted: false,
    ...extra,
  };
}
