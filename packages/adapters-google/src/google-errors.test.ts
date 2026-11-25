import { ReauthRequired } from '@jarvis/core';
import { describe, expect, it, vi } from 'vitest';
import { callGoogle, isRateLimited, retryAfterMs, type RetryPolicy } from './google-errors';

const quota = (extra: object = {}) =>
  Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost'"), { code: 429, ...extra });

function policy(delaysMs: number[] = [100, 200, 400]): RetryPolicy & { waits: number[] } {
  const waits: number[] = [];
  return { delaysMs, maxWaitMs: 1_000, waits, sleep: async (ms) => void waits.push(ms) };
}

describe('isRateLimited', () => {
  it('is true for 429 and for 403 with a rate-limit reason', () => {
    expect(isRateLimited(quota())).toBe(true);
    expect(isRateLimited({ code: 403, errors: [{ reason: 'userRateLimitExceeded' }] })).toBe(true);
    expect(isRateLimited({ response: { status: 403, data: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } } })).toBe(true);
  });

  it('is false for a 403 permission error and for other failures', () => {
    expect(isRateLimited({ code: 403, errors: [{ reason: 'insufficientPermissions' }] })).toBe(false);
    expect(isRateLimited({ code: 500 })).toBe(false);
    expect(isRateLimited(new Error('boom'))).toBe(false);
  });
});

describe('retryAfterMs', () => {
  it('reads the Retry-After header in seconds', () => {
    expect(retryAfterMs({ response: { headers: { 'retry-after': '7' } } })).toBe(7_000);
    expect(retryAfterMs({ response: { headers: {} } })).toBeUndefined();
    expect(retryAfterMs({ response: { headers: { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' } } })).toBeUndefined();
  });
});

describe('callGoogle', () => {
  it('retries a rate-limited request with growing waits until it succeeds', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(quota())
      .mockRejectedValueOnce(quota())
      .mockResolvedValueOnce({ data: 'ok' });
    const retry = policy();
    await expect(callGoogle('acc', request, retry)).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(3);
    expect(retry.waits).toEqual([100, 200]);
  });

  it('honours Retry-After, capped at maxWaitMs', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(quota({ response: { status: 429, headers: { 'retry-after': '0.5' } } }))
      .mockRejectedValueOnce(quota({ response: { status: 429, headers: { 'retry-after': '120' } } }))
      .mockResolvedValueOnce({ data: 1 });
    const retry = policy();
    await callGoogle('acc', request, retry);
    expect(retry.waits).toEqual([500, 1_000]);
  });

  it('gives up with the original error once the retries are used up', async () => {
    const request = vi.fn().mockRejectedValue(quota());
    const retry = policy([10, 20]);
    await expect(callGoogle('acc', request, retry)).rejects.toThrow(/Quota exceeded/);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors and still maps invalid_grant to ReauthRequired', async () => {
    const retry = policy();
    const boom = vi.fn().mockRejectedValue({ code: 500, message: 'backend' });
    await expect(callGoogle('acc', boom, retry)).rejects.toMatchObject({ code: 500 });
    expect(boom).toHaveBeenCalledTimes(1);
    const revoked = vi.fn().mockRejectedValue({ response: { data: { error: 'invalid_grant' } } });
    await expect(callGoogle('acc', revoked, retry)).rejects.toBeInstanceOf(ReauthRequired);
    expect(retry.waits).toEqual([]);
  });
});
