import { JarvisConfigSchema } from '@jarvis/config';
import { activeAccounts, EmailAddress } from '@jarvis/core';
import { InMemoryAccountRepository } from '@jarvis/core/testing';
import { describe, expect, it } from 'vitest';
import { ConfigAccountSeeder } from './config-account-seeder';

const config = JarvisConfigSchema.parse({
  accounts: [
    { id: 'personal', provider: 'google', email: 'me@example.com' },
    { id: 'work', provider: 'google', email: 'new@work.example' },
  ],
});

describe('ConfigAccountSeeder', () => {
  it('adds new accounts as active and keeps the status of existing ones', async () => {
    const repo = new InMemoryAccountRepository();
    await repo.upsert({
      id: 'work',
      provider: 'google',
      email: EmailAddress.parse('old@work.example'),
      displayName: 'Trabajo',
      status: 'needs_reauth',
    });

    await new ConfigAccountSeeder(repo, config).onModuleInit();

    expect(await repo.get('personal')).toEqual({
      id: 'personal',
      provider: 'google',
      email: EmailAddress.parse('me@example.com'),
      status: 'active',
      busyCalendars: ['primary'],
      missingScopes: [],
      createdVia: 'config',
    });
    expect(await repo.get('work')).toEqual({
      id: 'work',
      provider: 'google',
      email: EmailAddress.parse('new@work.example'),
      displayName: 'Trabajo',
      status: 'needs_reauth',
      busyCalendars: ['primary'],
      missingScopes: [],
      createdVia: 'config',
    });
  });

  it('disables accounts that are no longer in the config, so they are not synced nor picked as first active', async () => {
    const repo = new InMemoryAccountRepository();
    await repo.upsert({ id: 'removed', provider: 'google', email: EmailAddress.parse('old@x.example'), status: 'active' });
    await repo.upsert({ id: 'stale', provider: 'google', email: EmailAddress.parse('s@x.example'), status: 'needs_reauth' });

    await new ConfigAccountSeeder(repo, config).onModuleInit();

    expect((await repo.get('removed')).status).toBe('disabled');
    expect((await repo.get('stale')).status).toBe('disabled');
    expect((await activeAccounts(repo)).map((a) => a.id)).toEqual(['personal', 'work']);
  });

  it('re-enables a disabled account that is back in the config', async () => {
    const repo = new InMemoryAccountRepository();
    await repo.upsert({ id: 'work', provider: 'google', email: EmailAddress.parse('new@work.example'), status: 'disabled' });

    await new ConfigAccountSeeder(repo, config).onModuleInit();

    expect((await repo.get('work')).status).toBe('active');
  });
});
