import { randomBytes } from 'node:crypto';
import { EmailAddress, type AccountConnector, type AuthorizationResult, type AuthorizationStart } from '@jarvis/core';
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library';
import { google } from 'googleapis';
import type { ClientSecretReader } from './client-secret-store';
import { GOOGLE_SCOPES } from './scopes';
import type { FileTokenStore } from './token-store';

export type EmailResolver = (client: OAuth2Client) => Promise<string>;

const defaultEmailResolver: EmailResolver = async (client) => {
  const { data } = await google.gmail({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' });
  if (!data.emailAddress) throw new Error('Google did not return the account email address');
  return data.emailAddress;
};

/** Google implementation of the browser (PKCE) account authorization. */
export class GoogleAccountConnector implements AccountConnector {
  readonly kind = 'google';

  constructor(
    private readonly secrets: ClientSecretReader,
    private readonly store: FileTokenStore,
    private readonly resolveEmail: EmailResolver = defaultEmailResolver,
  ) {}

  async beginAuthorization(input: { redirectUri: string }): Promise<AuthorizationStart> {
    const client = await this.oauthClient(input.redirectUri);
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(16).toString('hex');
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...GOOGLE_SCOPES],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    return { url, state, verifier: codeVerifier! };
  }

  async completeAuthorization(input: {
    code: string;
    redirectUri: string;
    verifier: string;
  }): Promise<AuthorizationResult> {
    const client = await this.oauthClient(input.redirectUri);
    const { tokens } = await client.getToken({
      code: input.code,
      codeVerifier: input.verifier,
      redirect_uri: input.redirectUri,
    });
    if (!tokens.refresh_token) {
      throw new Error("Google returned no refresh_token; revoke the app's access in your Google account and retry");
    }
    client.setCredentials(tokens);
    const email = EmailAddress.parse(await this.resolveEmail(client));
    const grantedScopes = (tokens.scope ?? '').split(/\s+/).filter((s) => s !== '');
    return { email, credentials: tokens, grantedScopes };
  }

  async saveCredentials(accountId: string, credentials: unknown): Promise<void> {
    await this.store.write(accountId, credentials as Credentials);
  }

  async deleteCredentials(accountId: string): Promise<void> {
    await this.store.delete(accountId);
  }

  missingScopes(granted: string[]): string[] {
    return GOOGLE_SCOPES.filter((scope) => !granted.includes(scope));
  }

  private async oauthClient(redirectUri: string): Promise<OAuth2Client> {
    const { clientId, clientSecret } = await this.secrets.read();
    return new OAuth2Client(clientId, clientSecret, redirectUri);
  }
}
