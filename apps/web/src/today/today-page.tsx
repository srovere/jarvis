import { Link } from 'react-router-dom';
import { useToday } from '@/api/data-hooks';
import type { EventItem } from '@/api/data';
import { plainText } from '@/api/external-content';
import { useAccounts, useSettings } from '@/api/hooks';
import { QueryState } from '@/components/query-state';
import { Card } from '@/components/ui/card';
import { clock, fmtMinutes } from '@/lib/dates';

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card role="group" aria-label={label}>
      <div className="text-sm text-neutral-500">{label}</div>
      <div data-testid="value" className="text-2xl font-semibold">
        {value}
      </div>
    </Card>
  );
}

const minutesOfDay = (iso: string) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Gaps of at least 30 minutes between timed events inside the work hours (event times are in the configured zone). */
function freeGaps(events: EventItem[], startHour: number, endHour: number): { start: number; end: number }[] {
  const busy = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: minutesOfDay(e.start), end: minutesOfDay(e.end) }))
    .sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = startHour * 60;
  for (const b of busy) {
    if (b.start - cursor >= 30) gaps.push({ start: cursor, end: Math.min(b.start, endHour * 60) });
    cursor = Math.max(cursor, b.end);
  }
  if (endHour * 60 - cursor >= 30) gaps.push({ start: cursor, end: endHour * 60 });
  return gaps.filter((g) => g.end > g.start);
}

export function TodayPage() {
  const query = useToday();
  const settings = useSettings();
  const accounts = useAccounts();
  // Briefing emails do not say which account owns the thread: use the first active account (see report).
  const accountId = (accounts.data ?? []).find((a) => a.status === 'active')?.id ?? '';
  const work = settings.data?.workSchedule;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Today</h1>
      <QueryState query={query}>
        {(t) => (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryCard label="Meetings today" value={String(t.cards.meetings)} />
              <SummaryCard label="Free hours" value={fmtMinutes(t.cards.freeMinutes)} />
              <SummaryCard label="Priority emails" value={String(t.cards.priorityEmails)} />
              <SummaryCard label="Tasks due" value={String(t.cards.tasksDue)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <h2 className="mb-2 font-medium">Agenda</h2>
                <ul className="space-y-1 text-sm">
                  {t.events.length === 0 && <li className="text-neutral-500">No events today.</li>}
                  {t.events.map((e) => (
                    <li key={e.id}>
                      <Link className="hover:underline" to="/calendar">
                        <span className="text-neutral-500">{e.allDay ? 'All day' : `${clock(e.start)}–${clock(e.end)}`}</span> {plainText(e.title)}
                      </Link>
                    </li>
                  ))}
                  {work &&
                    freeGaps(t.events, work.startHour, work.endHour).map((g) => (
                      <li key={`free-${g.start}`} className="text-neutral-500">
                        Free {hhmm(g.start)}–{hhmm(g.end)}
                      </li>
                    ))}
                </ul>
              </Card>
              <Card>
                <h2 className="mb-2 font-medium">Priority emails</h2>
                <ul className="space-y-2 text-sm">
                  {t.emails.length === 0 && <li className="text-neutral-500">No priority emails.</li>}
                  {t.emails.map((m) => (
                    <li key={m.threadId}>
                      <Link className="block hover:underline" to={`/mail/${encodeURIComponent(accountId)}/${encodeURIComponent(m.threadId)}`}>
                        <span className="font-medium">{plainText(m.subject)}</span>
                        <span className="block text-neutral-500">{plainText(m.from)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h2 className="mb-2 font-medium">Tasks due</h2>
                <ul className="space-y-1 text-sm">
                  {t.tasks.length === 0 && <li className="text-neutral-500">Nothing due.</li>}
                  {t.tasks.map((k) => (
                    <li key={k.id}>
                      <Link className="hover:underline" to="/tasks">
                        {plainText(k.title)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
