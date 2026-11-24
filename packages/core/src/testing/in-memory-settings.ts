import type { Preferences } from '../domain/model/preferences';
import type { SettingsStore } from '../domain/ports/settings';

export class InMemorySettingsStore implements SettingsStore {
  private saved: Preferences | null = null;

  async load(): Promise<Preferences | null> {
    return this.saved && structuredClone(this.saved);
  }

  async save(p: Preferences): Promise<void> {
    this.saved = structuredClone(p);
  }
}
