import type { EmailAddress } from '../model/email-address';

export interface IdentityProvider {
  ownAddresses(): Promise<EmailAddress[]>;
}
