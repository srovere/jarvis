import { createHash, timingSafeEqual } from 'node:crypto';

export interface PendingAuthorization {
  readonly verifier: string;
  readonly kind: string;
  readonly returnTo: string;
  readonly expiresAt: number;
}

export const PENDING_TTL_MS = 10 * 60 * 1000;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * In-memory authorizations waiting for the provider's redirect, keyed by `state`. Entries are single use and expire
 * after 10 minutes; a lookup compares the presented state against every live entry in constant time.
 */
export class OAuthPending {
  private readonly entries = new Map<string, PendingAuthorization>();

  put(state: string, entry: Omit<PendingAuthorization, 'expiresAt'>, now: number): void {
    this.purge(now);
    this.entries.set(state, { ...entry, expiresAt: now + PENDING_TTL_MS });
  }

  /** Removes and returns the entry for `state`, or `null` when unknown or expired. */
  take(state: string, now: number): PendingAuthorization | null {
    this.purge(now);
    const wanted = digest(state);
    let found: string | null = null;
    for (const key of this.entries.keys()) {
      if (timingSafeEqual(digest(key), wanted)) found = key;
    }
    if (found === null) return null;
    const entry = this.entries.get(found)!;
    this.entries.delete(found);
    return entry;
  }

  private purge(now: number): void {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
