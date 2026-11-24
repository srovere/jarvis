import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, type Type } from '@nestjs/common';
import { z } from 'zod';
import { McpClientService } from './mcp-client.service';

/*
 * Dashboard data endpoints. User data is read and changed only through `mcp-server` tools (spec 10.2): each endpoint
 * validates its input, makes one tool call and returns the tool's `structuredContent` unchanged (`/today` aside).
 * A tool error becomes `502 { error }` in `McpClientService`; an invalid request is `400 { error }` without a call.
 * Every POST needs `Content-Type: application/json` (the local-only guard answers 415 otherwise), even without a body.
 * There is deliberately no endpoint that sends email: drafts only.
 */

/** ISO 8601 date (`2026-11-23`) or date-time, as `list_events` accepts. */
const isoDateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);
const duration = z.number().int().min(15).max(480).optional();
const preferredStartHour = z.number().int().min(0).max(23).optional();
const id = z.string().min(1);

/** Parses `input` or throws `400 { error }` naming each offending field. */
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const message = result.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ');
  throw new BadRequestException({ error: `Invalid request: ${message}` });
}

/** Drops `undefined` values so optional tool arguments are simply absent. */
function defined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

interface BriefingResult {
  date: string;
  events: unknown[];
  priorityEmails: unknown[];
  tasksDue: unknown[];
  freeMinutes: number;
}

@Controller('api/today')
export class TodayController {
  constructor(private readonly mcp: McpClientService) {}

  /** The day's briefing (`get_daily_briefing`) reshaped for the Today view. */
  @Get()
  async today() {
    const b = await this.mcp.call<BriefingResult>('get_daily_briefing', { date_offset_days: 0 });
    return {
      date: b.date,
      cards: {
        meetings: b.events.length,
        freeMinutes: b.freeMinutes,
        priorityEmails: b.priorityEmails.length,
        tasksDue: b.tasksDue.length,
      },
      events: b.events,
      emails: b.priorityEmails,
      tasks: b.tasksDue,
    };
  }
}

const SearchQuery = z.object({
  q: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  after: z.iso.date().optional(),
  before: z.iso.date().optional(),
  accountId: id.optional(),
});

const DraftBody = z
  .object({
    to: z.array(z.string().min(1)).optional(),
    cc: z.array(z.string().min(1)).optional(),
    subject: z.string().optional(),
    body: z.string().min(1),
    threadId: id.optional(),
  })
  .refine((d) => (d.to?.length ?? 0) > 0 || d.threadId !== undefined, { message: 'give to or threadId', path: ['to'] });

/** Gmail search syntax from the filters; `YYYY-MM-DD` becomes Gmail's `YYYY/MM/DD`. */
function gmailQuery(f: z.infer<typeof SearchQuery>): string {
  const parts: string[] = [];
  if (f.q) parts.push(f.q);
  if (f.from) parts.push(`from:"${f.from.replaceAll('"', '')}"`);
  if (f.after) parts.push(`after:${f.after.replaceAll('-', '/')}`);
  if (f.before) parts.push(`before:${f.before.replaceAll('-', '/')}`);
  return parts.join(' ');
}

@Controller('api/mail')
export class MailController {
  constructor(private readonly mcp: McpClientService) {}

  /** `search_emails`. `accountId` narrows the results (the tool searches every active account). */
  @Get('search')
  async search(@Query() query: unknown) {
    const f = parse(SearchQuery, query);
    const q = gmailQuery(f);
    if (!q) throw new BadRequestException({ error: 'Invalid request: give q, from, after or before' });
    const result = await this.mcp.call<{ emails: Array<{ accountId: string }> }>('search_emails', { query: q, max_results: 20 });
    return f.accountId === undefined ? result : { ...result, emails: result.emails.filter((e) => e.accountId === f.accountId) };
  }

  /** `read_thread`. */
  @Get('threads/:accountId/:threadId')
  thread(@Param('accountId') accountId: string, @Param('threadId') threadId: string) {
    return this.mcp.call('read_thread', { account_id: accountId, thread_id: threadId });
  }

  /** `create_gmail_draft`: a draft only, never a send. */
  @Post('drafts')
  draft(@Body() body: unknown) {
    const d = parse(DraftBody, body);
    return this.mcp.call('create_gmail_draft', defined({ to: d.to, cc: d.cc, subject: d.subject, body: d.body, thread_id: d.threadId }));
  }
}

const EventsQuery = z.object({ from: isoDateOrDateTime.optional(), to: isoDateOrDateTime.optional() });
const FreeSlotBody = z.object({ durationMinutes: duration, preferredStartHour });
const FocusBody = FreeSlotBody.extend({ taskName: z.string().trim().min(1) });

@Controller('api/calendar')
export class CalendarController {
  constructor(private readonly mcp: McpClientService) {}

  /**
   * `list_events`. `from`/`to` are passed through unchanged, and `to` is EXCLUSIVE (`to == from` is empty, at most 31
   * days): the client sends the day after the last day it wants to see.
   */
  @Get('events')
  events(@Query() query: unknown) {
    const q = parse(EventsQuery, query);
    return this.mcp.call('list_events', defined({ from: q.from, to: q.to }));
  }

  /** `list_calendars`. */
  @Get('calendars')
  calendars() {
    return this.mcp.call('list_calendars');
  }

  /** `find_free_slot` (read-only). */
  @Post('free-slot')
  @HttpCode(200)
  freeSlot(@Body() body: unknown) {
    const b = parse(FreeSlotBody, body);
    return this.mcp.call('find_free_slot', defined({ duration_minutes: b.durationMinutes, preferred_start_hour: b.preferredStartHour }));
  }

  /** `block_focus_time`. */
  @Post('focus')
  @HttpCode(200)
  focus(@Body() body: unknown) {
    const b = parse(FocusBody, body);
    return this.mcp.call(
      'block_focus_time',
      defined({ task_name: b.taskName, duration_minutes: b.durationMinutes, preferred_start_hour: b.preferredStartHour }),
    );
  }
}

const TasksQuery = z.object({ status: z.enum(['open', 'completed', 'all']).optional() });
const CreateTaskBody = z.object({ title: z.string().trim().min(1), notes: z.string().optional(), due: z.iso.date().optional() });

@Controller('api/tasks')
export class TasksController {
  constructor(private readonly mcp: McpClientService) {}

  /** `list_tasks`. */
  @Get()
  list(@Query() query: unknown) {
    const q = parse(TasksQuery, query);
    return this.mcp.call('list_tasks', defined({ status: q.status }));
  }

  /** `list_task_lists`. */
  @Get('lists')
  lists() {
    return this.mcp.call('list_task_lists');
  }

  /** `create_task`. */
  @Post()
  create(@Body() body: unknown) {
    const b = parse(CreateTaskBody, body);
    return this.mcp.call('create_task', defined({ title: b.title, notes: b.notes, due: b.due }));
  }

  /** `complete_task`; the tool finds the task by id, so `accountId` only has to be well formed. */
  @Post(':accountId/:taskId/complete')
  @HttpCode(200)
  complete(@Param('taskId') taskId: string) {
    return this.mcp.call('complete_task', { task_id: taskId });
  }
}

const SyncBody = z.object({ accountId: id.optional() });

@Controller('api/sync')
export class SyncController {
  constructor(private readonly mcp: McpClientService) {}

  /** `get_sync_status`. */
  @Get()
  status() {
    return this.mcp.call('get_sync_status');
  }

  /** `trigger_sync`: all active accounts, or the one in `accountId`. */
  @Post()
  @HttpCode(200)
  trigger(@Body() body: unknown) {
    const b = parse(SyncBody, body);
    return this.mcp.call('trigger_sync', defined({ account_id: b.accountId }));
  }
}

export const DATA_CONTROLLERS: Type<unknown>[] = [TodayController, MailController, CalendarController, TasksController, SyncController];
