import { describe, expect, it } from 'vitest';
import { EmailAddress } from '@jarvis/core';
import type { Account } from '@jarvis/core';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCalendarAdapter } from './calendar/google-calendar-adapter';
import { GmailAdapter } from './gmail/gmail-adapter';
import { GoogleProviderFactory } from './google-provider-factory';
import { GoogleTasksAdapter } from './tasks/google-tasks-adapter';

const account: Account = { id: 'acc-1', provider: 'google', email: EmailAddress.parse('me@x.com'), status: 'active' };

describe('GoogleProviderFactory', () => {
  it('builds the bundle from the OAuth client of the account, without network', async () => {
    const asked: string[] = [];
    const factory = new GoogleProviderFactory(
      { client: async (id) => (asked.push(id), new OAuth2Client('id', 'secret')) },
      'America/Argentina/Buenos_Aires',
    );
    const bundle = await factory.create(account);
    expect(factory.kind).toBe('google');
    expect(asked).toEqual(['acc-1']);
    expect(bundle.mail).toBeInstanceOf(GmailAdapter);
    expect(bundle.identity).toBe(bundle.mail);
    expect(bundle.calendar).toBeInstanceOf(GoogleCalendarAdapter);
    expect(bundle.tasks).toBeInstanceOf(GoogleTasksAdapter);
    expect(bundle.capabilities).toEqual({
      threads: true,
      replyHeaders: true,
      sendAsAliases: true,
      taskLists: true,
      incrementalSync: true,
    });
  });

  it('fingerprints with the token fingerprint of the OAuth source', async () => {
    const factory = new GoogleProviderFactory(
      { client: async () => new OAuth2Client('id', 'secret'), tokenFingerprint: async (id) => `fp-${id}` },
      'UTC',
    );
    expect(await factory.fingerprint(account)).toBe('fp-acc-1');
  });
});
