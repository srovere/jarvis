/** Outcome of connecting the assistant's agent (the `claude` CLI on a subscription). */
export interface AgentStatus {
  /** Agent kind that was verified; absent when the step was skipped. */
  provider?: string;
  status: 'connected' | 'failed' | 'skipped';
  /** ISO instant of the verification (or of the skip). */
  verifiedAt: string;
  latencyMs?: number;
  /** Why verification failed; never contains the token. */
  reason?: string;
}

/** Agent kinds Jarvis can connect. Subscription only: there is deliberately no API-key provider. */
export const AGENT_PROVIDERS: ReadonlyArray<{ readonly kind: string; readonly label: string }> = [
  { kind: 'claude', label: 'Claude (subscription)' },
];

/** Mail/calendar providers Jarvis can connect. */
export const MAIL_PROVIDERS: ReadonlyArray<{ readonly kind: string; readonly label: string }> = [
  { kind: 'google', label: 'Google (Gmail + Calendar)' },
];
