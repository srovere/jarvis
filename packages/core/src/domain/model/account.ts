import type { EmailAddress } from './email-address';

export type ProviderKind = 'google' | (string & {});

export interface Account {
  id: string;
  provider: ProviderKind;
  email: EmailAddress;
  displayName?: string;
  status: 'active' | 'needs_reauth' | 'disabled';
}
