import type { WorkSchedule } from '../domain/services/free-slot-finder';

/** Settings the use cases need, derived from the stored `Preferences` and the accounts. */
export interface AppSettings {
  zone: string;
  workSchedule: WorkSchedule;
  focus: { titlePrefix: string; horizonWorkDays: number; defaultDurationMinutes: number };
  sync: { intervalMinutes: number; gmailInitialWindowDays: number };
  briefing: { maxPriorityEmails: number };
  /** Calendars that count as busy, per account id; `['primary']` when an account is absent. */
  busyCalendars: Record<string, string[]>;
}

/** Source of the current settings; use cases call it once per `execute` so changes apply without a restart. */
export interface SettingsProvider {
  current(): Promise<AppSettings>;
}

export const DEFAULT_BUSY_CALENDARS = ['primary'];

export function busyCalendarsOf(settings: AppSettings, accountId: string): string[] {
  return settings.busyCalendars[accountId] ?? DEFAULT_BUSY_CALENDARS;
}
