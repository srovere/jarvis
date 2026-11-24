import type { EmailAddress } from '../model/email-address';
import type { ProviderKind } from '../model/account';

export interface AuthorizationStart {
  readonly url: string;
  readonly state: string;
  readonly verifier: string;
}

export interface AuthorizationResult {
  readonly email: EmailAddress;
  /** Opaque, provider-specific credentials; hand them back to `saveCredentials`. */
  readonly credentials: unknown;
  readonly grantedScopes: string[];
}

/** Connects an account of one provider through a browser authorization redirect (PKCE). */
export interface AccountConnector {
  readonly kind: ProviderKind;
  beginAuthorization(input: { redirectUri: string }): Promise<AuthorizationStart>;
  completeAuthorization(input: { code: string; redirectUri: string; verifier: string }): Promise<AuthorizationResult>;
  saveCredentials(accountId: string, credentials: unknown): Promise<void>;
  deleteCredentials(accountId: string): Promise<void>;
  /** Required scopes that `granted` lacks. */
  missingScopes(granted: string[]): string[];
}
