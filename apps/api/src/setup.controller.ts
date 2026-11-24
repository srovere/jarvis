import { GOOGLE_CLIENT_STATUS, type GoogleClientStatus } from '@jarvis/composition';
import { TOKENS, type AccountRepository, type ConnectAgent, type SettingsStore } from '@jarvis/core';
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';

export interface SetupStatus {
  accounts: number;
  agent: 'connected' | 'failed' | 'skipped' | 'none';
  preferencesSaved: boolean;
  googleClient: 'present' | 'missing';
}

interface ProviderOption {
  kind: string;
  label: string;
}

/** Onboarding state and the provider catalogues; talks to application services only. */
@Controller('api')
export class SetupController {
  constructor(
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(TOKENS.SettingsStore) private readonly settings: SettingsStore,
    @Inject(TOKENS.ConnectAgent) private readonly agent: Pick<ConnectAgent, 'status'>,
    @Inject(GOOGLE_CLIENT_STATUS) private readonly googleClient: GoogleClientStatus,
    @Inject(TOKENS.AgentProviders) private readonly agentProviders: readonly ProviderOption[],
    @Inject(TOKENS.MailProviders) private readonly mailProviders: readonly ProviderOption[],
  ) {}

  @Get('setup/status')
  async status(): Promise<SetupStatus> {
    const [accounts, agent, preferences, googleClient] = await Promise.all([
      this.accounts.list(),
      this.agent.status(),
      this.settings.load(),
      this.googleClient.status(),
    ]);
    return {
      accounts: accounts.filter((a) => a.status !== 'disabled').length,
      agent: agent?.status ?? 'none',
      preferencesSaved: preferences !== null,
      googleClient,
    };
  }

  @Get('providers')
  providers(@Query('kind') kind?: string): ProviderOption[] {
    if (kind === 'mail') return this.mailProviders.map(({ kind, label }) => ({ kind, label }));
    if (kind === 'agent') return this.agentProviders.map(({ kind, label }) => ({ kind, label }));
    throw new BadRequestException({ error: 'kind must be mail or agent' });
  }
}
