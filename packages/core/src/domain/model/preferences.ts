import type { AgentStatus } from './agent';

/** User-editable preferences, persisted as one document. Plain data; `AppSettings` is derived from it. */
export interface Preferences {
  /** IANA time zone every date is shown and computed in. */
  zone: string;
  workSchedule: {
    startHour: number;
    endHour: number;
    /** ISO weekdays, 1 = Monday. */
    workDays: number[];
  };
  focus: { titlePrefix: string; horizonWorkDays: number; defaultDurationMinutes: number };
  sync: { intervalMinutes: number; gmailInitialWindowDays: number };
  briefing: { maxPriorityEmails: number };
  /** Agent connection outcome, when one was recorded alongside the preferences. */
  agent?: AgentStatus;
}
