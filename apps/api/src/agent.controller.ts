import { TOKENS, type ConnectAgent } from '@jarvis/core';
import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Put } from '@nestjs/common';

const DEFAULT_KIND = 'claude';

/** Connects the assistant's agent with a subscription token. Tokens are accepted, never returned. */
@Controller('api/agent')
export class AgentController {
  constructor(@Inject(TOKENS.ConnectAgent) private readonly agent: Pick<ConnectAgent, 'saveToken' | 'verify' | 'skip'>) {}

  @Put('token')
  @HttpCode(204)
  async saveToken(@Body() body: unknown): Promise<void> {
    const { kind, token } = (body ?? {}) as { kind?: unknown; token?: unknown };
    if (typeof kind !== 'string' || typeof token !== 'string') {
      throw new BadRequestException({ error: 'kind and token must be strings' });
    }
    await this.agent.saveToken(kind, token);
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown): Promise<{ ok: boolean; latencyMs?: number; reason?: string }> {
    const kind = (body as { kind?: unknown } | null)?.kind ?? DEFAULT_KIND;
    if (typeof kind !== 'string') throw new BadRequestException({ error: 'kind must be a string' });
    const status = await this.agent.verify(kind);
    return {
      ok: status.status === 'connected',
      ...(status.latencyMs !== undefined ? { latencyMs: status.latencyMs } : {}),
      ...(status.reason !== undefined ? { reason: status.reason } : {}),
    };
  }

  @Post('skip')
  @HttpCode(204)
  async skip(): Promise<void> {
    await this.agent.skip();
  }
}
