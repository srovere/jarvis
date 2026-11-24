import type { EmailAddress } from './email-address';

/** OAuth scope that lets Jarvis list the account's calendars; without it only `primary` is known. */
export const CALENDAR_LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';

export type ProviderKind = 'google' | (string & {});

export interface Account {
  id: string;
  provider: ProviderKind;
  email: EmailAddress;
  displayName?: string;
  status: 'active' | 'needs_reauth' | 'disabled';
  /** Calendar ids whose events block time for this account; free-slot search uses the union over active accounts. */
  busyCalendars: string[];
  /** Required OAuth scopes the user did not grant (empty when consent was complete). */
  missingScopes: string[];
  /** Why the account is not `active` (e.g. the re-authorization hint); absent when active. */
  statusDetail?: string;
  createdVia: 'wizard' | 'config' | 'cli';
}
