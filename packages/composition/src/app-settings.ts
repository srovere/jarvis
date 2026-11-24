import { JarvisConfigSchema, type JarvisConfig } from '@jarvis/config';
import type { Preferences } from '@jarvis/core';

/** The preferences a validated configuration carries (YAML values, or the schema defaults for what it omits). */
export function preferencesFromConfig(config: JarvisConfig): Preferences {
  const { timezone, workSchedule, focus, sync, briefing } = config;
  return {
    zone: timezone,
    workSchedule: { startHour: workSchedule.startHour, endHour: workSchedule.endHour, workDays: [...workSchedule.workDays] },
    focus: { ...focus },
    sync: { intervalMinutes: sync.intervalMinutes, gmailInitialWindowDays: sync.gmailInitialWindowDays },
    briefing: { ...briefing },
  };
}

/** Preferences when neither the database nor a configuration file provides any: the schema defaults. */
export function defaultPreferences(): Preferences {
  return preferencesFromConfig(JarvisConfigSchema.parse({}));
}
