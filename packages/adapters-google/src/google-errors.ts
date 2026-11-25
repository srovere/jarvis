import { ReauthRequired } from '@jarvis/core';

interface ApiError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  errors?: unknown;
  response?: { status?: unknown; headers?: unknown; data?: { error?: unknown } };
}

const asApiError = (e: unknown): ApiError => (typeof e === 'object' && e !== null ? (e as ApiError) : {});

const hasStatus = (e: unknown, status: number): boolean => {
  const err = asApiError(e);
  return err.code === status || err.status === status || err.response?.status === status;
};

export const isNotFound = (e: unknown): boolean => hasStatus(e, 404);

/** 410: the cursor (`syncToken`) is no longer valid. */
export const isGone = (e: unknown): boolean => hasStatus(e, 410);

export function isInvalidGrant(e: unknown): boolean {
  const err = asApiError(e);
  return err.response?.data?.error === 'invalid_grant' || err.code === 'invalid_grant' || err.message === 'invalid_grant';
}

const RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded'];

const reasonsOf = (e: unknown): string[] => {
  const err = asApiError(e);
  const nested = asApiError(err.response?.data?.error).errors;
  const lists = [err.errors, nested].filter((l): l is unknown[] => Array.isArray(l));
  return lists.flat().flatMap((x) => {
    const reason = (asApiError(x) as { reason?: unknown }).reason;
    return typeof reason === 'string' ? [reason] : [];
  });
};

/** Google refused the request for quota or rate reasons (429, or 403 with a rate-limit reason): worth retrying later. */
export function isRateLimited(e: unknown): boolean {
  if (hasStatus(e, 429)) return true;
  return hasStatus(e, 403) && reasonsOf(e).some((r) => RATE_LIMIT_REASONS.includes(r));
}

/** The `Retry-After` header in milliseconds (seconds form only), or `undefined`. */
export function retryAfterMs(e: unknown): number | undefined {
  const headers = asApiError(e).response?.headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  const seconds = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** How `callGoogle` waits before retrying a rate-limited request. */
export interface RetryPolicy {
  /** One entry per retry: the wait before it when Google sends no `Retry-After`. */
  readonly delaysMs: readonly number[];
  /** Upper bound for a `Retry-After` wait. */
  readonly maxWaitMs: number;
  sleep(ms: number): Promise<void>;
}

/** Up to five retries over about a minute: Gmail's per-user quota is counted per minute. */
export const DEFAULT_RETRY: RetryPolicy = {
  delaysMs: [2_000, 4_000, 8_000, 16_000, 32_000],
  maxWaitMs: 60_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Unwraps `data`, maps `invalid_grant` to `ReauthRequired` and retries rate-limited requests (honouring
 * `Retry-After`) per `retry`; other errors, and a rate limit that outlasts the retries, propagate.
 */
export async function callGoogle<T>(
  accountId: string,
  request: () => Promise<{ data: T }>,
  retry: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await request()).data;
    } catch (e) {
      if (isInvalidGrant(e)) throw new ReauthRequired(accountId);
      const delay = retry.delaysMs[attempt];
      if (!isRateLimited(e) || delay === undefined) throw e;
      await retry.sleep(Math.min(retryAfterMs(e) ?? delay, retry.maxWaitMs));
    }
  }
}
