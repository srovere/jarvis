import { resolve } from 'node:path';
import type { JarvisConfig } from '@jarvis/config';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from './jarvis';

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const OK = { resources: { mail: 'ok', calendar: 'ok', tasks: 'skipped' }, fullResync: [] } as const;

function setup(authorize = vi.fn().mockResolvedValue(undefined)) {
  const created: unknown[] = [];
  const migrate = vi.fn().mockResolvedValue(undefined);
  const session = {
    run: vi.fn().mockResolvedValue([{ accountId: 'personal', result: OK }]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const openSync = vi.fn().mockResolvedValue(session);
  let databaseUrl: string | undefined = 'postgres://db/jarvis';
  const out: string[] = [];
  const err: string[] = [];
  const config = {
    accounts: [{ id: 'personal' }, { id: 'work' }],
    secretsDir: 'secrets',
    dataDir: '/abs/data',
  } as unknown as JarvisConfig;
  const deps: CliDeps = {
    loadConfig: () => ({ config, dir: '/etc/jarvis' }),
    createAuthorizer: (paths) => {
      created.push(paths);
      return { authorizeInteractive: authorize };
    },
    databaseUrl: () => {
      if (databaseUrl === undefined) throw new Error('Falta DATABASE_URL');
      return databaseUrl;
    },
    migrate,
    openSync,
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      throw new ExitCalled(code);
    },
  };
  const run = (...args: string[]) => buildProgram(deps).parseAsync(['node', 'jarvis', ...args]);
  const unsetDatabaseUrl = () => (databaseUrl = undefined);
  return { run, out, err, authorize, created, migrate, openSync, session, config, unsetDatabaseUrl };
}

describe('jarvis auth', () => {
  it('authorizes a configured account and confirms', async () => {
    const { run, out, authorize } = setup();
    await run('auth', '--account', 'personal');
    expect(authorize).toHaveBeenCalledWith('personal');
    expect(out).toEqual(['Token saved for personal']);
  });

  it('exits 1 listing configured ids for an unknown account', async () => {
    const { run, err, authorize } = setup();
    await expect(run('auth', '--account', 'nope')).rejects.toMatchObject({ code: 1 });
    expect(authorize).not.toHaveBeenCalled();
    expect(err).toEqual([
      'Account "nope" is not in the config. Configured accounts: personal, work',
    ]);
  });

  it('reports flow errors on stderr and exits 1', async () => {
    const { run, err } = setup(vi.fn().mockRejectedValue(new Error('boom')));
    await expect(run('auth', '--account', 'personal')).rejects.toMatchObject({ code: 1 });
    expect(err).toEqual(['boom']);
  });

  it('resolves relative secretsDir/dataDir against the config directory', async () => {
    const { run, created } = setup();
    await run('auth', '--account', 'personal');
    expect(created).toEqual([
      { clientSecretPath: resolve('/etc/jarvis/secrets/google_oauth_client'), tokenDir: '/abs/data/tokens' },
    ]);
  });

  it('exits 1 when --account is missing', async () => {
    const { run, err } = setup();
    await expect(run('auth')).rejects.toMatchObject({ code: 1 });
    expect(err.join('\n')).toContain('--account');
  });

  it('exits 0 for --help', async () => {
    const { run } = setup();
    await expect(run('--help')).rejects.toMatchObject({ code: 0 });
  });
});

describe('jarvis migrate', () => {
  it('applies migrations against DATABASE_URL', async () => {
    const { run, out, migrate } = setup();
    await run('migrate');
    expect(migrate).toHaveBeenCalledWith('postgres://db/jarvis');
    expect(out).toEqual(['Migraciones aplicadas']);
  });

  it('exits 1 with the error when DATABASE_URL is missing', async () => {
    const { run, err, migrate, unsetDatabaseUrl } = setup();
    unsetDatabaseUrl();
    await expect(run('migrate')).rejects.toMatchObject({ code: 1 });
    expect(migrate).not.toHaveBeenCalled();
    expect(err).toEqual(['Falta DATABASE_URL']);
  });

  it('exits 1 when migrations fail', async () => {
    const { run, err, migrate } = setup();
    migrate.mockRejectedValue(new Error('connection refused'));
    await expect(run('migrate')).rejects.toMatchObject({ code: 1 });
    expect(err).toEqual(['connection refused']);
  });
});

describe('jarvis sync --once', () => {
  it('syncs every active account, prints a JSON summary and closes the context', async () => {
    const { run, out, openSync, session, config } = setup();
    await run('sync', '--once');
    expect(openSync).toHaveBeenCalledWith({ config, configDir: '/etc/jarvis', databaseUrl: 'postgres://db/jarvis' });
    expect(session.run).toHaveBeenCalledWith(undefined);
    expect(out.map((l) => JSON.parse(l))).toEqual([{ accounts: [{ accountId: 'personal', result: OK }] }]);
    expect(session.close).toHaveBeenCalled();
  });

  it('syncs only the selected account', async () => {
    const { run, session } = setup();
    await run('sync', '--once', '--account', 'work');
    expect(session.run).toHaveBeenCalledWith('work');
  });

  it('exits 1 after printing the summary when an account failed', async () => {
    const { run, out, session } = setup();
    session.run.mockResolvedValue([
      { accountId: 'personal', result: OK },
      { accountId: 'work', error: 'boom' },
    ]);
    await expect(run('sync', '--once')).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(out[0] ?? '')).toEqual({
      accounts: [
        { accountId: 'personal', result: OK },
        { accountId: 'work', error: 'boom' },
      ],
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('exits 1 when a resource of an account failed', async () => {
    const { run, session } = setup();
    session.run.mockResolvedValue([
      { accountId: 'personal', result: { ...OK, resources: { ...OK.resources, calendar: 'error' } } },
    ]);
    await expect(run('sync', '--once')).rejects.toMatchObject({ code: 1 });
  });

  it('reports a run failure on stderr, closes the context and exits 1', async () => {
    const { run, err, session } = setup();
    session.run.mockRejectedValue(new Error('Account not active: nope'));
    await expect(run('sync', '--once', '--account', 'nope')).rejects.toMatchObject({ code: 1 });
    expect(err).toEqual(['Account not active: nope']);
    expect(session.close).toHaveBeenCalled();
  });

  it('requires --once', async () => {
    const { run, err, openSync } = setup();
    await expect(run('sync')).rejects.toMatchObject({ code: 1 });
    expect(openSync).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('--once');
  });
});
