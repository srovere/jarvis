import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

const audit = () => ({
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

export interface StoredAddress {
  address: string;
  name?: string;
}

export interface StoredAttendee {
  email: StoredAddress;
  response: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  self: boolean;
}

/** `id` is the configured account id (e.g. 'personal'), not a generated uuid: accounts come from config. */
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  status: text('status').$type<'active' | 'needs_reauth' | 'disabled'>().notNull(),
  statusDetail: text('status_detail'),
  calendarsBusy: text('calendars_busy').array().notNull().default(sql`'{primary}'::text[]`),
  missingScopes: text('missing_scopes').array().notNull().default(sql`'{}'::text[]`),
  /** Set by `trigger_sync`; the worker syncs the account on its next poll and clears it. */
  syncRequestedAt: tz('sync_requested_at'),
  createdVia: text('created_via').$type<'wizard' | 'config' | 'cli'>().notNull().default('config'),
  ...audit(),
});

const accountId = () =>
  text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' });

export const syncState = pgTable(
  'sync_state',
  {
    id: id(),
    accountId: accountId(),
    resource: text('resource').notNull(),
    cursor: text('cursor'),
    lastRunAt: tz('last_run_at'),
    ...audit(),
  },
  (t) => [unique('sync_state_account_resource_uq').on(t.accountId, t.resource)],
);

export const mailThreads = pgTable(
  'mail_threads',
  {
    id: id(),
    accountId: accountId(),
    externalId: text('external_id').notNull(),
    subject: text('subject').notNull(),
    lastMessageAt: tz('last_message_at').notNull(),
    unread: boolean('unread').notNull().default(false),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    raw: jsonb('raw'),
    ...audit(),
  },
  (t) => [
    unique('mail_threads_account_external_uq').on(t.accountId, t.externalId),
    index('mail_threads_account_last_message_idx').on(t.accountId, t.lastMessageAt.desc()),
  ],
);

/** Deliberately has no body columns: mail bodies are never persisted. */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: id(),
    accountId: accountId(),
    externalId: text('external_id').notNull(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => mailThreads.id, { onDelete: 'cascade' }),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    to: jsonb('to').$type<StoredAddress[]>().notNull(),
    cc: jsonb('cc').$type<StoredAddress[]>().notNull(),
    subject: text('subject').notNull(),
    sentAt: tz('sent_at').notNull(),
    snippet: text('snippet').notNull(),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    messageIdHeader: text('message_id_header'),
    referencesHeader: text('references_header'),
    raw: jsonb('raw'),
    ...audit(),
  },
  (t) => [
    unique('mail_messages_account_external_uq').on(t.accountId, t.externalId),
    index('mail_messages_thread_idx').on(t.threadId, t.sentAt),
  ],
);

export const calendars = pgTable(
  'calendars',
  {
    id: id(),
    accountId: accountId(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...audit(),
  },
  (t) => [unique('calendars_account_external_uq').on(t.accountId, t.externalId)],
);

export const events = pgTable(
  'events',
  {
    id: id(),
    accountId: accountId(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    startsAt: tz('starts_at').notNull(),
    endsAt: tz('ends_at').notNull(),
    allDay: boolean('all_day').notNull(),
    blocksTime: boolean('blocks_time').notNull().default(true),
    status: text('status').$type<'confirmed' | 'tentative' | 'cancelled'>().notNull(),
    myResponse: text('my_response').$type<StoredAttendee['response']>(),
    attendees: jsonb('attendees').$type<StoredAttendee[]>().notNull(),
    videoLink: text('video_link'),
    htmlLink: text('html_link'),
    raw: jsonb('raw'),
    ...audit(),
  },
  (t) => [
    unique('events_account_calendar_external_uq').on(t.accountId, t.calendarId, t.externalId),
    index('events_account_starts_at_idx').on(t.accountId, t.startsAt),
  ],
);

export const taskLists = pgTable(
  'task_lists',
  {
    id: id(),
    accountId: accountId(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    ...audit(),
  },
  (t) => [unique('task_lists_account_external_uq').on(t.accountId, t.externalId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    accountId: accountId(),
    listId: uuid('list_id')
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status').$type<'open' | 'completed'>().notNull(),
    dueAt: tz('due_at'),
    createdAtExt: tz('created_at_ext'),
    updatedAtExt: tz('updated_at_ext').notNull(),
    completedAt: tz('completed_at'),
    deleted: boolean('deleted').notNull().default(false),
    raw: jsonb('raw'),
    ...audit(),
  },
  (t) => [
    unique('tasks_account_list_external_uq').on(t.accountId, t.listId, t.externalId),
    index('tasks_account_status_due_idx').on(t.accountId, t.status, t.dueAt),
  ],
);

/** Singleton row (id = 1) holding the user-editable settings document. */
export const settings = pgTable(
  'settings',
  {
    id: smallint('id').primaryKey(),
    data: jsonb('data').notNull(),
    ...audit(),
  },
  (t) => [check('settings_singleton_ck', sql`${t.id} = 1`)],
);
