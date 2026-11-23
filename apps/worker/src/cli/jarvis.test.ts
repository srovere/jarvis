import { resolve } from 'node:path';
import type { JarvisConfig } from '@jarvis/config';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram, defaultConfigPath, type CliDeps } from './jarvis';

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function setup(authorize = vi.fn().mockResolvedValue(undefined)) {
  const created: unknown[] = [];
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
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      throw new ExitCalled(code);
    },
  };
  const run = (...args: string[]) => buildProgram(deps).parseAsync(['node', 'jarvis', ...args]);
  return { run, out, err, authorize, created };
}

describe('jarvis auth', () => {
  it('authorizes a configured account and confirms', async () => {
    const { run, out, authorize } = setup();
    await run('auth', '--account', 'personal');
    expect(authorize).toHaveBeenCalledWith('personal');
    expect(out).toEqual(['Token guardado para personal']);
  });

  it('exits 1 listing configured ids for an unknown account', async () => {
    const { run, err, authorize } = setup();
    await expect(run('auth', '--account', 'nope')).rejects.toMatchObject({ code: 1 });
    expect(authorize).not.toHaveBeenCalled();
    expect(err).toEqual([
      'La cuenta "nope" no existe en la configuración. Cuentas configuradas: personal, work',
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

describe('defaultConfigPath', () => {
  it('prefers JARVIS_CONFIG, then INIT_CWD, then cwd', () => {
    expect(defaultConfigPath({ JARVIS_CONFIG: '/x/c.yaml', INIT_CWD: '/i' }, '/w')).toBe('/x/c.yaml');
    expect(defaultConfigPath({ INIT_CWD: '/i' }, '/w')).toBe('/i/jarvis.config.yaml');
    expect(defaultConfigPath({}, '/w')).toBe('/w/jarvis.config.yaml');
  });
});
