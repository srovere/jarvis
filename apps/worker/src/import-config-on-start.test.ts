import { JarvisConfigSchema } from '@jarvis/config';
import { ImportConfig } from '@jarvis/core';
import { InMemoryAccountRepository, InMemorySettingsStore } from '@jarvis/core/testing';
import { describe, expect, it } from 'vitest';
import { ImportConfigOnStart } from './import-config-on-start';

const config = JarvisConfigSchema.parse({
  timezone: 'Europe/Madrid',
  sync: { intervalMinutes: 9 },
  accounts: [{ id: 'personal', provider: 'google', email: 'me@example.com', calendars: ['primary', 'team'] }],
});

function setup() {
  const accounts = new InMemoryAccountRepository();
  const settings = new InMemorySettingsStore();
  const lines: string[] = [];
  const hook = new ImportConfigOnStart(new ImportConfig(accounts, settings), config, (l) => lines.push(l));
  return { accounts, settings, lines, hook };
}

describe('ImportConfigOnStart', () => {
  it('imports the YAML accounts and preferences into an empty database', async () => {
    const { accounts, settings, hook } = setup();
    await hook.onModuleInit();
    expect((await accounts.get('personal')).busyCalendars).toEqual(['primary', 'team']);
    expect((await settings.load())?.zone).toBe('Europe/Madrid');
    expect((await settings.load())?.sync.intervalMinutes).toBe(9);
  });

  it('does not override dashboard edits on a later start, and warns once about the ignored accounts', async () => {
    const { accounts, lines, hook } = setup();
    await hook.onModuleInit();
    await accounts.setBusyCalendars('personal', ['edited']);
    lines.length = 0;
    await hook.onModuleInit();
    expect((await accounts.get('personal')).busyCalendars).toEqual(['edited']);
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(['warn']);
  });
});
