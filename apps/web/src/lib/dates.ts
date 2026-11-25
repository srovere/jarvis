/** Date helpers on `YYYY-MM-DD` strings (calendar arithmetic only, no time zones involved). */

const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY_MS);

/** The Monday of the week that contains `d`. */
export function mondayOf(d: string): string {
  const dow = new Date(toUtc(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** Today's date in `zone` (the browser's zone when absent or invalid). */
export function todayIn(zone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  }
}

export const dayLabel = (d: string) =>
  new Date(toUtc(d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** e.g. `Wednesday, November 25, 2026`. */
export const longDayLabel = (d: string) =>
  new Date(toUtc(d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** `HH:mm` of an ISO date-time as written (its own offset is the configured zone's); empty for date-only values. */
export const clock = (iso: string) => (iso.length > 10 ? iso.slice(11, 16) : '');

export const fmtSlot = (s: { start: string; end: string }) => `${s.start.slice(0, 10)} ${clock(s.start)}–${clock(s.end)}`;

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}
