import { JARVIS_CONFIG, LOG_SINK, preferencesFromConfig, type LogSink } from '@jarvis/composition';
import type { JarvisConfig } from '@jarvis/config';
import { ImportConfig } from '@jarvis/core';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

/**
 * On start, hands the YAML configuration to `ImportConfig`, which imports it only into an empty database.
 * Afterwards the database wins: YAML accounts are ignored (with one warning) and never touch existing ones.
 */
@Injectable()
export class ImportConfigOnStart implements OnModuleInit {
  constructor(
    @Inject(ImportConfig) private readonly importConfig: ImportConfig,
    @Inject(JARVIS_CONFIG) private readonly config: JarvisConfig,
    @Inject(LOG_SINK) private readonly log: LogSink,
  ) {}

  async onModuleInit(): Promise<void> {
    const outcome = await this.importConfig.execute({
      preferences: preferencesFromConfig(this.config),
      accounts: this.config.accounts.map(({ id, provider, email, calendars }) => ({
        id,
        provider,
        email,
        ...(calendars ? { calendars } : {}),
      })),
    });
    if (outcome === 'imported') {
      this.log(JSON.stringify({ level: 'info', msg: 'configuration imported', accounts: this.config.accounts.length }));
    } else if (this.config.accounts.length > 0) {
      this.log(
        JSON.stringify({
          level: 'warn',
          msg: 'accounts in the YAML configuration are ignored: the database already has accounts or settings',
        }),
      );
    }
  }
}
