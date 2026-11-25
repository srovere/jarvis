import { useState } from 'react';
import type { Account, CalendarInfo, Preferences } from '@/api/client';
import { plainText } from '@/api/external-content';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimezoneCombobox } from './timezone-combobox';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const CALENDAR_LIST_SCOPE = 'calendar.calendarlist';

export interface PreferencesSubmit {
  preferences: Preferences;
  /** Busy calendar ids per account id. */
  busy: Record<string, string[]>;
}

interface Props {
  initial: Preferences;
  /** Active accounts; each gets its own busy-calendar choice. */
  accounts: Account[];
  /** Calendars from `/api/calendar/calendars`; `null` when that request failed. */
  calendars: CalendarInfo[] | null;
  submitLabel: string;
  pending?: boolean;
  /** Error from the caller's own save (for example an API error). */
  error?: string | null;
  onSubmit: (value: PreferencesSubmit) => void;
}

const numberInput = (value: number, set: (n: number) => void) => ({
  type: 'number' as const,
  value: Number.isNaN(value) ? '' : value,
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value === '' ? Number.NaN : Number(e.target.value)),
});

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-3">
      <label htmlFor={htmlFor} className="pt-2 text-sm font-medium">
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

/** Choice of calendars that block time for one account, with a manual fallback when the list is unavailable. */
function BusyCalendars({
  account,
  calendars,
  value,
  onChange,
}: {
  account: Account;
  calendars: CalendarInfo[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const mine = calendars.filter((c) => c.accountId === account.id);
  const fallback = mine.length === 0 || mine.some((c) => c.missingScope) || account.missingScopes.some((s) => s.includes(CALENDAR_LIST_SCOPE));
  const [extra, setExtra] = useState(() => value.filter((id) => id !== 'primary').join(', '));
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));

  if (!fallback) {
    // Only ids the list shows are kept: a hidden one (e.g. a stale default) would be synced without the user seeing it.
    const listed = new Set(mine.map((c) => c.id));
    const toggleListed = (id: string, on: boolean) =>
      onChange((on ? [...value, id] : value.filter((v) => v !== id)).filter((v) => listed.has(v)));
    return (
      <fieldset className="space-y-1">
        <legend className="text-sm text-neutral-600">{account.email}</legend>
        {mine.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(c.id)} onChange={(e) => toggleListed(c.id, e.target.checked)} />
            {plainText(c.title)}
          </label>
        ))}
      </fieldset>
    );
  }

  const setExtraIds = (text: string) => {
    setExtra(text);
    const ids = text.split(',').map((s) => s.trim()).filter((s) => s !== '');
    onChange([...(value.includes('primary') ? ['primary'] : []), ...ids]);
  };
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm text-neutral-600">{account.email}</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.includes('primary')} onChange={(e) => (e.target.checked ? onChange(['primary', ...value]) : toggle('primary', false))} />
        primary
      </label>
      <Input aria-label={`Additional calendar ids for ${account.email}`} placeholder="calendar ids, comma separated" value={extra} onChange={(e) => setExtraIds(e.target.value)} />
      <p className="text-xs text-neutral-500">Reconnect to grant calendar list access</p>
    </fieldset>
  );
}

/** Preferences grid shared by the onboarding wizard and Settings. */
export function PreferencesForm({ initial, accounts, calendars, submitLabel, pending = false, error = null, onSubmit }: Props) {
  const [zone, setZone] = useState(initial.zone);
  const [startHour, setStartHour] = useState(initial.workSchedule.startHour);
  const [endHour, setEndHour] = useState(initial.workSchedule.endHour);
  const [workDays, setWorkDays] = useState(initial.workSchedule.workDays);
  const [horizon, setHorizon] = useState(initial.focus.horizonWorkDays);
  const [prefix, setPrefix] = useState(initial.focus.titlePrefix);
  const [duration, setDuration] = useState(initial.focus.defaultDurationMinutes);
  const [interval, setInterval] = useState(initial.sync.intervalMinutes);
  const [window, setWindow] = useState(initial.sync.gmailInitialWindowDays);
  const [maxEmails, setMaxEmails] = useState(initial.briefing.maxPriorityEmails);
  const [busy, setBusy] = useState<Record<string, string[]>>(() => Object.fromEntries(accounts.map((a) => [a.id, a.busyCalendars.length > 0 ? a.busyCalendars : ['primary']])));
  const [formError, setFormError] = useState<string | null>(null);

  const positive = (n: number) => Number.isInteger(n) && n > 0;

  function validate(): string | null {
    if (![startHour, endHour].every((h) => Number.isInteger(h)) || startHour < 0 || endHour > 24) return 'Work hours must be whole hours between 0 and 24.';
    if (startHour >= endHour) return 'Work hours must start before they end.';
    if (workDays.length === 0) return 'Pick at least one work day.';
    if (![horizon, duration, interval, window, maxEmails].every(positive)) return 'Advanced values must be positive whole numbers.';
    if (accounts.some((a) => (busy[a.id] ?? []).length === 0)) return 'Pick at least one calendar per account.';
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    setFormError(problem);
    if (problem) return;
    onSubmit({
      preferences: {
        zone,
        workSchedule: { startHour, endHour, workDays: [...workDays].sort((a, b) => a - b) },
        focus: { titlePrefix: prefix, horizonWorkDays: horizon, defaultDurationMinutes: duration },
        sync: { intervalMinutes: interval, gmailInitialWindowDays: window },
        briefing: { maxPriorityEmails: maxEmails },
      },
      busy,
    });
  }

  const shownError = formError ?? error;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Row label="Time zone" htmlFor="pref-zone">
        <TimezoneCombobox id="pref-zone" value={zone} onChange={setZone} />
      </Row>
      <Row label="Work hours">
        <div className="flex items-center gap-2">
          <label htmlFor="pref-from" className="text-sm">From</label>
          <Input id="pref-from" className="w-20" min={0} max={23} {...numberInput(startHour, setStartHour)} />
          <label htmlFor="pref-to" className="text-sm">To</label>
          <Input id="pref-to" className="w-20" min={1} max={24} {...numberInput(endHour, setEndHour)} />
        </div>
      </Row>
      <Row label="Work days">
        <div className="flex flex-wrap gap-2">
          {DAYS.map((name, i) => {
            const day = i + 1;
            const on = workDays.includes(day);
            return (
              <Button
                key={name}
                type="button"
                size="sm"
                variant={on ? 'default' : 'outline'}
                aria-pressed={on}
                onClick={() => setWorkDays(on ? workDays.filter((d) => d !== day) : [...workDays, day])}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </Row>
      <Row label="Calendars that block time">
        <div className="space-y-3">
          {accounts.map((a) => (
            <BusyCalendars key={a.id} account={a} calendars={calendars ?? []} value={busy[a.id] ?? []} onChange={(ids) => setBusy((b) => ({ ...b, [a.id]: ids }))} />
          ))}
        </div>
      </Row>
      <Row label="Focus search horizon" htmlFor="pref-horizon">
        <div className="flex items-center gap-2">
          <Input id="pref-horizon" className="w-20" min={1} {...numberInput(horizon, setHorizon)} />
          <span className="text-sm text-neutral-600">work days</span>
        </div>
      </Row>
      <details className="rounded-md border border-neutral-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-3 space-y-3">
          <Row label="Focus prefix" htmlFor="pref-prefix">
            <Input id="pref-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </Row>
          <Row label="Focus duration (min)" htmlFor="pref-duration">
            <Input id="pref-duration" className="w-24" min={1} {...numberInput(duration, setDuration)} />
          </Row>
          <Row label="Sync interval (min)" htmlFor="pref-interval">
            <Input id="pref-interval" className="w-24" min={1} {...numberInput(interval, setInterval)} />
          </Row>
          <Row label="Max priority emails" htmlFor="pref-max-emails">
            <Input id="pref-max-emails" className="w-24" min={1} {...numberInput(maxEmails, setMaxEmails)} />
          </Row>
          <Row label="First Gmail sync (days)" htmlFor="pref-window">
            <Input id="pref-window" className="w-24" min={1} {...numberInput(window, setWindow)} />
          </Row>
        </div>
      </details>
      {shownError && (
        <p role="alert" className="text-sm text-red-700">
          {shownError}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
