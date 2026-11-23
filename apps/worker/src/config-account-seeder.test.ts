import { JarvisConfigSchema } from '@jarvis/config';
import { EmailAddress } from '@jarvis/core';
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
    });
    expect(await repo.get('work')).toEqual({
      id: 'work',
      provider: 'google',
      email: EmailAddress.parse('new@work.example'),
      displayName: 'Trabajo',
      status: 'needs_reauth',
    });
  });
});
