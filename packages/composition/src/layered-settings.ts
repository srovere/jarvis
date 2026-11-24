import type { AccountRepository, AppSettings, Clock, Preferences, SettingsProvider, SettingsStore } from '@jarvis/core';
import { defaultPreferences } from './app-settings';

/**
 * Settings resolved as database row > YAML-derived preferences > schema defaults, with busy calendars taken from
 * the active accounts. The result is cached for `ttlMs` so a change made from the dashboard reaches the worker
 * and the MCP server within seconds, without a restart and without a query per call.
 */
export class LayeredSettings implements SettingsProvider {
  private cached: { value: AppSettings; expiresAt: number } | null = null;

  constructor(
    private readonly store: SettingsStore,
    private readonly accounts: AccountRepository,
    private readonly yaml: Preferences | null,
    private readonly clock: Clock,
    private readonly ttlMs = 5000,
  ) {}

  async current(): Promise<AppSettings> {
    const now = this.clock.now().toMillis();
    if (this.cached && now < this.cached.expiresAt) return this.cached.value;
    const value = await this.build();
    this.cached = { value, expiresAt: now + this.ttlMs };
    return value;
  }

  private async build(): Promise<AppSettings> {
    const prefs = (await this.store.load()) ?? this.yaml ?? defaultPreferences();
    const accounts = (await this.accounts.list()).filter((a) => a.status === 'active');
    return {
      zone: prefs.zone,
      workSchedule: { zone: prefs.zone, ...prefs.workSchedule, workDays: [...prefs.workSchedule.workDays] },
      focus: { ...prefs.focus },
      sync: { ...prefs.sync },
      briefing: { ...prefs.briefing },
      busyCalendars: Object.fromEntries(accounts.map((a) => [a.id, [...a.busyCalendars]])),
    };
  }
}
