import type { AgentStatus } from '../model/agent';

export type AgentVerification = { ok: true; latencyMs: number } | { ok: false; reason: string };

/** Runs a minimal request against an agent to prove its credentials work. */
export interface AgentRunner {
  readonly kind: string;
  verify(): Promise<AgentVerification>;
}

/** Secret storage for the agent token. */
export interface AgentCredentialStore {
  save(token: string): Promise<void>;
  present(): Promise<boolean>;
  clear(): Promise<void>;
}

/**
 * Where the agent connection result is kept. Separate from `SettingsStore` on purpose: onboarding connects the agent
 * before preferences are saved, and saving it there would make preferences look saved too early.
 */
export interface AgentStatusStore {
  load(): Promise<AgentStatus | null>;
  save(status: AgentStatus): Promise<void>;
}
