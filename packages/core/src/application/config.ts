import type { WorkSchedule } from '../domain/services/free-slot-finder';

/** Settings the use cases need; the app builds it from `JarvisConfig` so `core` does not depend on `@jarvis/config`. */
export interface AppSettings {
  zone: string;
  workSchedule: WorkSchedule;
  focus: { titlePrefix: string; horizonWorkDays: number; defaultDurationMinutes: number };
  sync: { gmailInitialWindowDays: number };
  briefing: { maxPriorityEmails: number };
  /** Calendars that count as busy, per account id; `['primary']` when an account is absent. */
  busyCalendars: Record<string, string[]>;
}

export const DEFAULT_BUSY_CALENDARS = ['primary'];

export function busyCalendarsOf(settings: AppSettings, accountId: string): string[] {
  return settings.busyCalendars[accountId] ?? DEFAULT_BUSY_CALENDARS;
}
