import { DomainError } from '../../domain/errors';
import type { AgentStatus } from '../../domain/model/agent';
import type { AgentCredentialStore, AgentRunner, AgentStatusStore } from '../../domain/ports/agent';
import type { Clock } from '../../domain/ports/clock';

const API_KEY_PREFIX = 'sk-ant-api';

/** Connects the agent through the user's Claude subscription token; API keys are refused. */
export class ConnectAgent {
  constructor(
    private readonly runners: AgentRunner[],
    private readonly credentials: AgentCredentialStore,
    private readonly statuses: AgentStatusStore,
    private readonly clock: Clock,
  ) {}

  async saveToken(kind: string, token: string): Promise<void> {
    this.runner(kind);
    const value = token.trim();
    if (!value) throw new DomainError('The token is empty. Paste the output of `claude setup-token`.');
    if (value.startsWith(API_KEY_PREFIX)) {
      throw new DomainError(
        'This looks like an API key. Jarvis uses your Claude subscription: run `claude setup-token`.',
      );
    }
    await this.credentials.save(value);
  }

  async verify(kind: string): Promise<AgentStatus> {
    const runner = this.runner(kind);
    const result = await runner.verify();
    const verifiedAt = this.clock.now().toUTC().toISO()!;
    const status: AgentStatus = result.ok
      ? { provider: kind, status: 'connected', verifiedAt, latencyMs: result.latencyMs }
      : { provider: kind, status: 'failed', verifiedAt, reason: result.reason };
    await this.statuses.save(status);
    return status;
  }

  async skip(): Promise<AgentStatus> {
    const status: AgentStatus = { status: 'skipped', verifiedAt: this.clock.now().toUTC().toISO()! };
    await this.statuses.save(status);
    return status;
  }

  status(): Promise<AgentStatus | null> {
    return this.statuses.load();
  }

  private runner(kind: string): AgentRunner {
    const runner = this.runners.find((r) => r.kind === kind);
    if (!runner) throw new DomainError(`Unknown agent provider "${kind}"`);
    return runner;
  }
}
