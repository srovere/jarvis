/** An account whose user asked for an immediate sync, and when. */
export interface PendingSyncRequest {
  accountId: string;
  requestedAt: Date;
}

/** Accounts whose user asked for an immediate sync (e.g. from the dashboard). */
export interface SyncRequests {
  /** Pending requests, oldest first. */
  pending(): Promise<PendingSyncRequest[]>;
  /**
   * Clears the request only if it was made at or before `observedAt` (the time `pending()` reported), so a request
   * that arrives while the account is syncing stays pending.
   */
  clear(accountId: string, observedAt: Date): Promise<void>;
  /** Marks the accounts as wanting an immediate sync (the worker picks them up on its next poll). */
  request(accountIds: string[]): Promise<void>;
}
