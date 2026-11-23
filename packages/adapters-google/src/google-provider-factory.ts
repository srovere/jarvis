import type { Account, ProviderBundle, ProviderFactory, ProviderCapabilities } from '@jarvis/core';
import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { GoogleCalendarAdapter } from './calendar/google-calendar-adapter';
import { GmailAdapter } from './gmail/gmail-adapter';
import { GoogleTasksAdapter } from './tasks/google-tasks-adapter';

export interface OAuthClientSource {
  client(accountId: string): Promise<OAuth2Client>;
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
    private readonly zone: string,
  ) {}

  async create(account: Account): Promise<ProviderBundle> {
    const auth = await this.oauth.client(account.id);
    const gmail = new GmailAdapter(google.gmail({ version: 'v1', auth }), account.id);
    return {
      mail: gmail,
      identity: gmail,
      calendar: new GoogleCalendarAdapter(google.calendar({ version: 'v3', auth }), account.id, this.zone),
      tasks: new GoogleTasksAdapter(google.tasks({ version: 'v1', auth }), account.id, this.zone),
      capabilities: { ...GOOGLE_CAPABILITIES },
    };
  }
}
