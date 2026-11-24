import { JARVIS_CONFIG } from '@jarvis/composition';
import type { JarvisConfig } from '@jarvis/config';
import { EmailAddress, TOKENS, type AccountRepository } from '@jarvis/core';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

/**
 * Reconciles the accounts with the config on start. New accounts start `active`; an existing account keeps its
 * display name and its status, except `disabled` (set below), which is lifted when it is back in the config.
 * `needs_reauth` is only cleared by `jarvis auth`. Accounts no longer in the config become `disabled`, so
 * they are not synced, briefed nor chosen as the default account for writes.
 */
@Injectable()
export class ConfigAccountSeeder implements OnModuleInit {
  constructor(
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(JARVIS_CONFIG) private readonly config: JarvisConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = new Map((await this.accounts.list()).map((a) => [a.id, a]));
    for (const { id, provider, email, calendars } of this.config.accounts) {
      const current = existing.get(id);
      await this.accounts.upsert({
        id,
        provider,
        email: EmailAddress.parse(email),
        ...(current?.displayName ? { displayName: current.displayName } : {}),
        status: current === undefined || current.status === 'disabled' ? 'active' : current.status,
        busyCalendars: calendars ?? current?.busyCalendars ?? ['primary'],
        missingScopes: current?.missingScopes ?? [],
        createdVia: current?.createdVia ?? 'config',
      });
    }
    const configured = new Set(this.config.accounts.map((a) => a.id));
    for (const { id, status } of existing.values()) {
      if (!configured.has(id) && status !== 'disabled') {
        await this.accounts.setStatus(id, 'disabled', 'removed from the configuration');
      }
    }
  }
}
