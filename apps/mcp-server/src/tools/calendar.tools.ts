import { TOKENS, type BlockFocusResult, type BlockFocusTime, type FindFreeSlot, type ListEvents } from '@jarvis/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { dateTime, eventLine, section, time } from './format';
import { briefingEventSchema, isoDateOrDateTime } from './schemas';
import type { ToolGroup } from './tool-group';
import { ToolRunner } from './tool-runner';

const durationMinutes = z
  .number()
  .int()
  .min(15)
  .max(480)
  .default(90)
  .describe('Length of the slot in minutes (15-480).');
const preferredStartHour = z
  .number()
  .int()
  .min(0)
  .max(23)
  .optional()
  .describe('Preferred start hour (0-23, user time zone); earlier slots are tried after it.');

/** `list_events`, `find_free_slot`, `block_focus_time`. */
@Injectable()
export class CalendarTools implements ToolGroup {
  constructor(
    @Inject(TOKENS.ListEvents) private readonly events: Pick<ListEvents, 'execute'>,
    @Inject(TOKENS.FindFreeSlot) private readonly freeSlot: Pick<FindFreeSlot, 'execute'>,
    @Inject(TOKENS.BlockFocusTime) private readonly focus: Pick<BlockFocusTime, 'execute'>,
    private readonly runner: ToolRunner,
  ) {}

  register(server: McpServer): void {
    this.registerListEvents(server);
    this.registerFindFreeSlot(server);
    this.registerBlockFocusTime(server);
  }

  private registerListEvents(server: McpServer): void {
    server.registerTool(
      'list_events',
      {
        title: 'List calendar events',
        description:
          "List the user's calendar events (every active account; cancelled and declined ones excluded) that " +
          'overlap [from, to). Use it for agenda questions about a specific period ("what do I have next week?"); ' +
          'for a single day overview prefer get_daily_briefing. Based on the last sync.',
        inputSchema: {
          from: isoDateOrDateTime.describe('Start (inclusive), ISO 8601 date or date-time.'),
          to: isoDateOrDateTime.describe('End (exclusive), ISO 8601 date or date-time.'),
        },
        outputSchema: { events: z.array(briefingEventSchema) },
      },
      ({ from, to }) =>
        this.runner.run('list_events', async () => {
          const events = await this.events.execute({ from, to });
          return { text: section('Eventos', events.map((e) => eventLine(e)), 'eventos en ese rango'), structured: { events } };
        }),
    );
  }

  private registerFindFreeSlot(server: McpServer): void {
    server.registerTool(
      'find_free_slot',
      {
        title: 'Find free slot',
        description:
          'Find the first free slot of the given length within working hours over the next work days, considering ' +
          'the busy calendars of every active account. Read-only: it reserves nothing. Use it to answer "when am I ' +
          'free?" or before proposing a meeting time; to actually reserve focus time use block_focus_time.',
        inputSchema: { duration_minutes: durationMinutes, preferred_start_hour: preferredStartHour },
        outputSchema: { slot: z.object({ start: z.string(), end: z.string() }).nullable() },
      },
      ({ duration_minutes, preferred_start_hour }) =>
        this.runner.run('find_free_slot', async () => {
          const slot = await this.freeSlot.execute({
            durationMinutes: duration_minutes,
            ...(preferred_start_hour !== undefined ? { preferredStartHour: preferred_start_hour } : {}),
          });
          return {
            text: slot
              ? `Primer hueco libre: ${dateTime(slot.start)}–${time(slot.end)}`
              : `No hay un hueco libre de ${duration_minutes} minutos en el horizonte de búsqueda.`,
            structured: { slot },
          };
        }),
    );
  }

  private registerBlockFocusTime(server: McpServer): void {
    server.registerTool(
      'block_focus_time',
      {
        title: 'Block focus time',
        description:
          'Reserve a focus block for a task on the primary calendar of the first active account, in the first ' +
          'free working-hours slot over the next work days. Use it when the user wants time set aside to work on ' +
          'something. Idempotent: if an upcoming block for the same task already exists it is returned ' +
          '(status "already_exists"); status "no_slot" means nothing fits.',
        inputSchema: {
          task_name: z.string().min(1).describe('What the focus time is for; it becomes the event title.'),
          duration_minutes: durationMinutes,
          preferred_start_hour: preferredStartHour,
        },
        outputSchema: {
          status: z.enum(['created', 'already_exists', 'no_slot']),
          eventId: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          htmlLink: z.string().optional(),
          searchedWorkDays: z.number().optional(),
        },
      },
      ({ task_name, duration_minutes, preferred_start_hour }) =>
        this.runner.run('block_focus_time', async () => {
          const result = await this.focus.execute({
            taskName: task_name,
            durationMinutes: duration_minutes,
            ...(preferred_start_hour !== undefined ? { preferredStartHour: preferred_start_hour } : {}),
          });
          return { text: focusSummary(task_name, result), structured: result };
        }),
    );
  }
}

function focusSummary(task: string, r: BlockFocusResult): string {
  switch (r.status) {
    case 'created':
      return `Bloque de foco «${task}» creado: ${dateTime(r.start)}–${time(r.end)}${r.htmlLink ? ` (${r.htmlLink})` : ''}`;
    case 'already_exists':
      return `Ya existe un bloque de foco «${task}»: ${dateTime(r.start)}–${time(r.end)}`;
    case 'no_slot':
      return `No hay hueco libre para «${task}» en los próximos ${r.searchedWorkDays} días hábiles.`;
  }
}
