import { EmailAddress } from '../../domain/model/email-address';
import type { Preferences } from '../../domain/model/preferences';
import type { SettingsStore } from '../../domain/ports/settings';
import type { AccountRepository } from '../../domain/ports/repositories';

export interface ConfigSeed {
  preferences: Preferences;
  accounts: { id: string; provider: string; email: string; calendars?: string[] }[];
}

/**
 * Imports the YAML configuration into the database, once: only when the database has neither an account nor a
 * settings row. Afterwards the database is the source of truth, so dashboard edits are never overwritten.
 */
export class ImportConfig {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly settings: SettingsStore,
  ) {}

  async execute(seed: ConfigSeed): Promise<'imported' | 'skipped'> {
    if ((await this.accounts.list()).length > 0 || (await this.settings.load()) !== null) return 'skipped';
    for (const { id, provider, email, calendars } of seed.accounts) {
      await this.accounts.upsert({
        id,
        provider,
        email: EmailAddress.parse(email),
        status: 'active',
        busyCalendars: calendars ? [...calendars] : ['primary'],
        missingScopes: [],
        createdVia: 'config',
      });
    }
    await this.settings.save(seed.preferences);
    return 'imported';
  }
}
