import type { Account, ProviderBundle, ProviderFactory, ProviderCapabilities } from '@jarvis/core';
import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { GoogleCalendarAdapter } from './calendar/google-calendar-adapter';
import { GmailAdapter } from './gmail/gmail-adapter';
import { GoogleTasksAdapter } from './tasks/google-tasks-adapter';

export interface OAuthClientSource {
  client(accountId: string): Promise<OAuth2Client>;
  /** Identifies the stored credentials, so a re-authorized token is noticed. */
  tokenFingerprint?(accountId: string): Promise<string>;
}

export const GOOGLE_CAPABILITIES: ProviderCapabilities = {
  threads: true,
  replyHeaders: true,
  sendAsAliases: true,
  taskLists: true,
  incrementalSync: true,
};

export class GoogleProviderFactory implements ProviderFactory {
  readonly kind = 'google';

  constructor(
    private readonly oauth: OAuthClientSource,
    /** Live source of the user's time zone; read on every fingerprint/create so a zone change rebuilds the bundle. */
    private readonly zone: () => Promise<string>,
  ) {}

  async fingerprint(account: Account): Promise<string> {
    const token = (await this.oauth.tokenFingerprint?.(account.id)) ?? 'static';
    return `${token}:${await this.zone()}`;
  }

  async create(account: Account): Promise<ProviderBundle> {
    const auth = await this.oauth.client(account.id);
    const zone = await this.zone();
    const gmail = new GmailAdapter(google.gmail({ version: 'v1', auth }), account.id);
    return {
      mail: gmail,
      identity: gmail,
      calendar: new GoogleCalendarAdapter(google.calendar({ version: 'v3', auth }), account.id, zone),
      tasks: new GoogleTasksAdapter(google.tasks({ version: 'v1', auth }), account.id, zone),
      capabilities: { ...GOOGLE_CAPABILITIES },
    };
  }
}
