import { JARVIS_CONFIG } from '@jarvis/composition';
import type { JarvisConfig } from '@jarvis/config';
import { EmailAddress, TOKENS, type AccountRepository } from '@jarvis/core';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

/**
 * Upserts the configured accounts on start. New accounts start `active`; an existing account keeps its
 * status (`needs_reauth`/`disabled` are only cleared by re-authorizing) and display name.
 */
@Injectable()
export class ConfigAccountSeeder implements OnModuleInit {
  constructor(
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(JARVIS_CONFIG) private readonly config: JarvisConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = new Map((await this.accounts.list()).map((a) => [a.id, a]));
    for (const { id, provider, email } of this.config.accounts) {
      const current = existing.get(id);
      await this.accounts.upsert({
        id,
        provider,
        email: EmailAddress.parse(email),
        ...(current?.displayName ? { displayName: current.displayName } : {}),
        status: current?.status ?? 'active',
      });
    }
  }
}
