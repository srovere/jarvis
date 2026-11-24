import type { Preferences } from '../model/preferences';

/** Persistence of the single preferences document. */
export interface SettingsStore {
  /** `null` when preferences were never saved. */
  load(): Promise<Preferences | null>;
  save(p: Preferences): Promise<void>;
}
