import type { BriefingEvent, BriefingTask, EmailResult } from '@jarvis/core';
import { DateTime } from 'luxon';

/** Compact Spanish text for tool summaries; ISO values keep their own offset (the configured zone). */
export function dateTime(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).toFormat('yyyy-LL-dd HH:mm');
}

export function time(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).toFormat('HH:mm');
}

export function eventLine(e: BriefingEvent, sameDay = false): string {
  const when = e.allDay
    ? `${sameDay ? '' : `${e.start.slice(0, 10)} `}todo el día`
    : sameDay
      ? `${time(e.start)}–${time(e.end)}`
      : `${dateTime(e.start)}–${time(e.end)}`;
  return `- ${when} ${e.title}${e.videoLink ? ` (${e.videoLink})` : ''} [id ${e.id}]`;
}

export function taskLine(t: BriefingTask): string {
  return `- ${t.title}${t.due ? ` (vence ${t.due.slice(0, 10)})` : ''} — lista ${t.list} [id ${t.id}]`;
}

/** `body` is expected already wrapped as external content. */
export function emailBlock(m: EmailResult): string {
  return `- ${dateTime(m.date)} De: ${m.from} — ${m.subject} [hilo ${m.threadId}]\n${m.body}`;
}

/** A titled list, or "Sin <empty>." when there are no lines. */
export function section(title: string, lines: string[], empty: string): string {
  return lines.length ? `${title} (${lines.length}):\n${lines.join('\n')}` : `Sin ${empty}.`;
}
