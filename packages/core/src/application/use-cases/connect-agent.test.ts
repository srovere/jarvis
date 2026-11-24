import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../domain/model/agent';
import type { AgentCredentialStore, AgentRunner, AgentStatusStore, AgentVerification } from '../../domain/ports/agent';
import { FixedClock } from '../../testing/fixed-clock';
import { ConnectAgent } from './connect-agent';

class FakeRunner implements AgentRunner {
  readonly kind = 'claude';
  result: AgentVerification = { ok: true, latencyMs: 1200 };
  async verify() {
    return this.result;
  }
}
class FakeCredentials implements AgentCredentialStore {
  token: string | null = null;
  async save(t: string) {
    this.token = t;
  }
  async present() {
    return this.token !== null;
  }
  async clear() {
    this.token = null;
  }
}
class FakeStatus implements AgentStatusStore {
  saved: AgentStatus | null = null;
  async load() {
    return this.saved;
  }
  async save(s: AgentStatus) {
    this.saved = s;
  }
}

function setup() {
  const runner = new FakeRunner();
  const credentials = new FakeCredentials();
  const status = new FakeStatus();
  const clock = new FixedClock(DateTime.fromISO('2026-11-24T10:00:00Z', { zone: 'utc' }));
  return { runner, credentials, status, uc: new ConnectAgent([runner], credentials, status, clock) };
}

describe('ConnectAgent', () => {
  it('rejects an API key without storing it or echoing it', async () => {
    const { uc, credentials } = setup();
    const key = 'sk-ant-api03-SECRETSECRET';
    const err = await uc.saveToken('claude', key).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      'This looks like an API key. Jarvis uses your Claude subscription: run `claude setup-token`.',
    );
    expect((err as Error).message).not.toContain('SECRET');
    expect(credentials.token).toBeNull();
  });

  it('rejects an empty token and an unknown provider', async () => {
    const { uc, credentials } = setup();
    await expect(uc.saveToken('claude', '   ')).rejects.toThrow(/empty/i);
    await expect(uc.saveToken('gpt', 'tok')).rejects.toThrow(/unknown agent provider/i);
    expect(credentials.token).toBeNull();
  });

  it('stores a trimmed subscription token', async () => {
    const { uc, credentials } = setup();
    await uc.saveToken('claude', '  sk-ant-oat01-abc \n');
    expect(credentials.token).toBe('sk-ant-oat01-abc');
  });

  it('records a successful verification', async () => {
    const { uc, status } = setup();
    expect(await uc.verify('claude')).toEqual({
      provider: 'claude',
      status: 'connected',
      verifiedAt: '2026-11-24T10:00:00.000Z',
      latencyMs: 1200,
    });
    expect(status.saved?.status).toBe('connected');
  });

  it('records a failed verification with its reason', async () => {
    const { uc, runner, status } = setup();
    runner.result = { ok: false, reason: 'Timed out after 60 s' };
    const out = await uc.verify('claude');
    expect(out).toMatchObject({ provider: 'claude', status: 'failed', reason: 'Timed out after 60 s' });
    expect(status.saved).toEqual(out);
  });

  it('records a skip without a provider', async () => {
    const { uc, status } = setup();
    expect(await uc.skip()).toEqual({ status: 'skipped', verifiedAt: '2026-11-24T10:00:00.000Z' });
    expect(await uc.status()).toEqual(status.saved);
  });
});
