import type { JarvisConfig } from '@jarvis/config';
import { DEFAULT_BUSY_CALENDARS, type AppSettings } from '@jarvis/core';

/** Builds the use cases' settings from the validated configuration. */
export function toAppSettings(config: JarvisConfig): AppSettings {
  const { timezone: zone, workSchedule, focus, sync, briefing, accounts } = config;
  return {
    zone,
    workSchedule: {
      zone,
      startHour: workSchedule.startHour,
      endHour: workSchedule.endHour,
      workDays: [...workSchedule.workDays],
    },
    focus: { ...focus },
    sync: { gmailInitialWindowDays: sync.gmailInitialWindowDays },
    briefing: { ...briefing },
    busyCalendars: Object.fromEntries(accounts.map((a) => [a.id, a.calendars ?? [...DEFAULT_BUSY_CALENDARS]])),
  };
}
