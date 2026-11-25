import { useState } from 'react';
import { useEvents } from '@/api/data-hooks';
import { plainText } from '@/api/external-content';
import { useSettings } from '@/api/hooks';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { addDays, clock, dayLabel, mondayOf, todayIn } from '@/lib/dates';
import { FocusDialog } from './focus-dialog';
import { FreeSlotDialog } from './free-slot-dialog';

export function CalendarPage() {
  const settings = useSettings();
  // The week is Mon-Sun in the configured zone; the browser's zone is the fallback while settings are unavailable.
  const zoneReady = !settings.isPending;
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const [dialog, setDialog] = useState<'free' | 'focus' | null>(null);
  const monday = addDays(mondayOf(todayIn(settings.data?.zone)), offsetWeeks * 7);
  const nextMonday = addDays(monday, 7); // `to` is exclusive
  const events = useEvents(monday, nextMonday, zoneReady);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDialog('free')}>
            Find free slot
          </Button>
          <Button variant="outline" onClick={() => setDialog('focus')}>
            Block focus time
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOffsetWeeks((w) => w - 1)}>
          Previous week
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOffsetWeeks(0)}>
          This week
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOffsetWeeks((w) => w + 1)}>
          Next week
        </Button>
        <span className="text-sm text-neutral-600">
          {dayLabel(monday)} – {dayLabel(addDays(monday, 6))}
        </span>
      </div>
      {zoneReady && (
        <QueryState query={events}>
          {({ events: list }) => (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
              {days.map((d) => (
                <section key={d} aria-label={dayLabel(d)} className="min-h-24 rounded-lg border border-neutral-200 bg-white p-2">
                  <h2 className="mb-1 text-xs font-medium text-neutral-500">{dayLabel(d)}</h2>
                  <ul className="space-y-1 text-xs">
                    {list
                      .filter((e) => e.start.slice(0, 10) === d)
                      .sort((a, b) => a.start.localeCompare(b.start))
                      .map((e) => (
                        <li key={e.id} className="rounded bg-neutral-100 p-1">
                          <span className="text-neutral-500">{e.allDay ? 'All day' : `${clock(e.start)}–${clock(e.end)}`}</span> {plainText(e.title)}
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </QueryState>
      )}
      {dialog === 'free' && <FreeSlotDialog onClose={() => setDialog(null)} />}
      {dialog === 'focus' && <FocusDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
