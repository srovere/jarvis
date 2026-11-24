import { describe, expect, it } from 'vitest';
import type { Preferences, SettingsStore } from '@jarvis/core';

const prefs = (extra: Partial<Preferences> = {}): Preferences => ({
  zone: 'Europe/Madrid',
  workSchedule: { startHour: 8, endHour: 17, workDays: [1, 2, 3] },
  focus: { titlePrefix: '[F] ', horizonWorkDays: 3, defaultDurationMinutes: 60 },
  sync: { intervalMinutes: 7, gmailInitialWindowDays: 30 },
  briefing: { maxPriorityEmails: 4 },
  ...extra,
});

export function describeSettingsContract(name: string, setup: () => Promise<SettingsStore>): void {
  describe(`SettingsStore contract: ${name}`, () => {
    it('loads null when nothing was ever saved', async () => {
      expect(await (await setup()).load()).toBeNull();
    });

    it('round-trips the saved preferences', async () => {
      const store = await setup();
      await store.save(prefs());
      expect(await store.load()).toEqual(prefs());
    });

    it('keeps a single document: the last save wins', async () => {
      const store = await setup();
      await store.save(prefs());
      await store.save(prefs({ zone: 'America/Argentina/Buenos_Aires', workSchedule: { startHour: 10, endHour: 18, workDays: [1, 5] } }));
      expect(await store.load()).toEqual(
        prefs({ zone: 'America/Argentina/Buenos_Aires', workSchedule: { startHour: 10, endHour: 18, workDays: [1, 5] } }),
      );
    });
  });
}
