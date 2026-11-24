import { GOOGLE_CLIENT_STATUS, type GoogleClientStatus } from '@jarvis/composition';
import { DomainError, TOKENS, type Clock, type ConnectAccount } from '@jarvis/core';
import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import { OAuthPending } from './oauth-pending';

interface RedirectingResponse {
  redirect(status: number, url: string): void;
}

/** The only pages the browser may be sent back to; anything else becomes the default (no open redirect). */
const RETURN_PATHS: ReadonlySet<string> = new Set(['/onboarding', '/settings/accounts']);
const DEFAULT_RETURN = '/onboarding';
const redirectUri = (kind: string): string => `http://127.0.0.1:3000/api/oauth/${kind}/callback`;

const MESSAGES = {
  noClient: 'Upload the Google OAuth client file first.',
  startFailed: 'Could not start the authorization. Try again.',
  denied: 'Access was denied. Authorize Jarvis to connect the account.',
  invalidState: 'The authorization request is invalid or expired. Start again.',
  failed: 'Could not connect the account. Try again.',
} as const;

/** Browser OAuth flow: `start` redirects to the provider, `callback` finishes the connection and returns to the app. */
@Controller('api/oauth/:kind')
export class OAuthController {
  private readonly pending = new OAuthPending();

  constructor(
    @Inject(TOKENS.ConnectAccount) private readonly connect: Pick<ConnectAccount, 'begin' | 'complete'>,
    @Inject(GOOGLE_CLIENT_STATUS) private readonly googleClient: GoogleClientStatus,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  @Get('start')
  async start(
    @Param('kind') kind: string,
    @Query('returnTo') returnTo: unknown,
    @Res() res: RedirectingResponse,
  ): Promise<void> {
    const back = allowedReturn(returnTo);
    try {
      if (kind === 'google' && (await this.googleClient.status()) === 'missing') {
        return fail(res, back, MESSAGES.noClient);
      }
      const { url, state, verifier } = await this.connect.begin(kind, redirectUri(kind));
      this.pending.put(state, { verifier, kind, returnTo: back }, this.now());
      res.redirect(302, url);
    } catch (e) {
      fail(res, back, e instanceof DomainError ? e.message : MESSAGES.startFailed);
    }
  }

  @Get('callback')
  async callback(
    @Param('kind') kind: string,
    @Query('state') state: unknown,
    @Query('code') code: unknown,
    @Query('error') error: unknown,
    @Res() res: RedirectingResponse,
  ): Promise<void> {
    // The state is consumed first so a replay or a denied attempt cannot be retried.
    const entry = typeof state === 'string' && state ? this.pending.take(state, this.now()) : null;
    if (!entry || entry.kind !== kind) return fail(res, DEFAULT_RETURN, MESSAGES.invalidState);
    if (error !== undefined) {
      return fail(res, entry.returnTo, error === 'access_denied' ? MESSAGES.denied : MESSAGES.failed);
    }
    if (typeof code !== 'string' || !code) return fail(res, entry.returnTo, MESSAGES.failed);
    try {
      const account = await this.connect.complete(kind, { code, redirectUri: redirectUri(kind), verifier: entry.verifier });
      res.redirect(302, `${entry.returnTo}?connected=${encodeURIComponent(account.id)}`);
    } catch (e) {
      // Only domain messages (written for users) are shown; anything else may carry provider details.
      fail(res, entry.returnTo, e instanceof DomainError ? e.message : MESSAGES.failed);
    }
  }

  private now(): number {
    return this.clock.now().toMillis();
  }
}

function allowedReturn(value: unknown): string {
  return typeof value === 'string' && RETURN_PATHS.has(value) ? value : DEFAULT_RETURN;
}

function fail(res: RedirectingResponse, returnTo: string, message: string): void {
  res.redirect(302, `${returnTo}?error=${encodeURIComponent(message)}`);
}
