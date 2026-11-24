import { resolve } from 'node:path';
import type { JarvisConfig } from '@jarvis/config';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from './jarvis';

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const OK = { status: 'active', resources: { mail: 'ok', calendar: 'ok', tasks: 'skipped' }, fullResync: [] } as const;

const RECEIVED = { code: 'c', redirectUri: 'http://127.0.0.1:1/cb', verifier: 'v' };

function setup(complete = vi.fn().mockResolvedValue({ id: 'ana', email: { address: 'ana@example.com' } })) {
  const created: unknown[] = [];
  const migrate = vi.fn().mockResolvedValue(undefined);
  const begin = vi.fn().mockResolvedValue({ url: 'u', state: 's', verifier: 'v' });
  const closeConnect = vi.fn().mockResolvedValue(undefined);
  const openConnect = vi.fn().mockResolvedValue({ begin, complete, close: closeConnect });
  const receive = vi.fn(async (b: (r: string) => Promise<unknown>) => {
    await b(RECEIVED.redirectUri);
    return RECEIVED;
  });
  const session = {
    run: vi.fn().mockResolvedValue([{ accountId: 'personal', status: 'active', result: OK }]),
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
      return { receiveAuthorizationCode: receive };
    },
    databaseUrl: () => {
      if (databaseUrl === undefined) throw new Error('Missing DATABASE_URL');
      return databaseUrl;
    },
    migrate,
    openConnect,
    openSync,
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      throw new ExitCalled(code);
    },
  };
  const run = (...args: string[]) => buildProgram(deps).parseAsync(['node', 'jarvis', ...args]);
  const unsetDatabaseUrl = () => (databaseUrl = undefined);
  return { run, out, err, complete, begin, closeConnect, openConnect, receive, created, migrate, openSync, session, config, unsetDatabaseUrl };
}

describe('jarvis auth', () => {
  it('connects an account with a derived id (no --account) as createdVia cli', async () => {
    const { run, out, complete, begin, closeConnect } = setup();
    await run('auth');
    expect(begin).toHaveBeenCalledWith('google', RECEIVED.redirectUri);
    expect(complete).toHaveBeenCalledWith('google', RECEIVED, { createdVia: 'cli' });
    expect(out).toEqual(['Token saved for ana (ana@example.com)']);
    expect(closeConnect).toHaveBeenCalled();
  });

  it('passes an explicit --account, even when it is not in the YAML config', async () => {
    const { run, complete } = setup();
    await run('auth', '--account', 'nope');
    expect(complete).toHaveBeenCalledWith('google', RECEIVED, { accountId: 'nope', createdVia: 'cli' });
  });

  it('reports a conflicting account id and still closes the session', async () => {
    const { run, err, closeConnect } = setup(vi.fn().mockRejectedValue(new Error('Account id "x" is already used by another email')));
    await expect(run('auth', '--account', 'x')).rejects.toMatchObject({ code: 1 });
    expect(err).toEqual(['Account id "x" is already used by another email']);
    expect(closeConnect).toHaveBeenCalled();
  });

  it('reports a missing DATABASE_URL before opening anything', async () => {
    const { run, err, unsetDatabaseUrl, receive } = setup();
    unsetDatabaseUrl();
    await expect(run('auth')).rejects.toMatchObject({ code: 1 });
    expect(err).toEqual(['Missing DATABASE_URL']);
    expect(receive).not.toHaveBeenCalled();
  });

  it('resolves relative secretsDir/dataDir against the config directory', async () => {
    const { run, created } = setup();
    await run('auth');
    expect(created).toEqual([
      { clientSecretPath: resolve('/etc/jarvis/secrets/google_oauth_client'), tokenDir: '/abs/data/tokens' },
    ]);
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
    expect(out).toEqual(['Migrations applied']);
  });

  it('exits 1 with the error when DATABASE_URL is missing', async () => {
    const { run, err, migrate, unsetDatabaseUrl } = setup();
    unsetDatabaseUrl();
    await expect(run('migrate')).rejects.toMatchObject({ code: 1 });
    expect(migrate).not.toHaveBeenCalled();
    expect(err).toEqual(['Missing DATABASE_URL']);
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
    expect(openSync).toHaveBeenCalledWith({ config, configDir: '/etc/jarvis', configPresent: true, databaseUrl: 'postgres://db/jarvis' });
    expect(session.run).toHaveBeenCalledWith(undefined);
    expect(out.map((l) => JSON.parse(l))).toEqual([{ accounts: [{ accountId: 'personal', status: 'active', result: OK }] }]);
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
      { accountId: 'personal', status: 'active', result: OK },
      { accountId: 'work', status: 'active', error: 'boom' },
    ]);
    await expect(run('sync', '--once')).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(out[0] ?? '')).toEqual({
      accounts: [
        { accountId: 'personal', status: 'active', result: OK },
        { accountId: 'work', status: 'active', error: 'boom' },
      ],
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('exits 1 when a resource of an account failed', async () => {
    const { run, session } = setup();
    session.run.mockResolvedValue([
      { accountId: 'personal', status: 'active', result: { ...OK, resources: { ...OK.resources, calendar: 'error' } } },
    ]);
    await expect(run('sync', '--once')).rejects.toMatchObject({ code: 1 });
  });

  it('exits 1 after printing the summary when an account needs re-authorization', async () => {
    const { run, out, err, session } = setup();
    session.run.mockResolvedValue([
      { accountId: 'personal', status: 'active', result: OK },
      { accountId: 'work', status: 'needs_reauth' },
    ]);
    await expect(run('sync', '--once')).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(out[0] ?? '').accounts[1]).toEqual({ accountId: 'work', status: 'needs_reauth' });
    expect(err.join('\n')).toContain('work');
    expect(err.join('\n')).toContain('jarvis auth --account work');
  });

  it('exits 1 when no account is active', async () => {
    const { run, out, err, session } = setup();
    session.run.mockResolvedValue([]);
    await expect(run('sync', '--once')).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(out[0] ?? '')).toEqual({ accounts: [] });
    expect(err).toEqual(['No active accounts to sync']);
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
