import { describe, expect, it } from 'vitest';
import type { AgentRunner } from '@jarvis/core';

export interface AgentRunnerContractSetup {
  /** Runner whose agent accepts the credentials. */
  working: AgentRunner;
  /** Runner whose agent rejects the credentials. */
  rejected: AgentRunner;
  /** A secret that must never show up in a failure reason. */
  secret: string;
}

export function describeAgentRunnerContract(name: string, setup: () => Promise<AgentRunnerContractSetup>): void {
  describe(`AgentRunner contract: ${name}`, () => {
    it('reports ok with a non-negative latency when the agent answers', async () => {
      const { working } = await setup();
      const r = await working.verify();
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('reports a non-empty reason, without the secret, when the agent rejects the credentials', async () => {
      const { rejected, secret } = await setup();
      const r = await rejected.verify();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason.length).toBeGreaterThan(0);
        expect(r.reason).not.toContain(secret);
      }
    });
  });
}
