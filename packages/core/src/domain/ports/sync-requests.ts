/** Accounts whose user asked for an immediate sync (e.g. from the dashboard). */
export interface SyncRequests {
  /** Ids of the accounts with a pending request. */
  pending(): Promise<string[]>;
  clear(accountId: string): Promise<void>;
  /** Marks the accounts as wanting an immediate sync (the worker picks them up on its next poll). */
  request(accountIds: string[]): Promise<void>;
}
