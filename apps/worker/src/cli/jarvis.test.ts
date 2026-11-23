import type { JarvisConfig } from '@jarvis/config';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from './jarvis';

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function setup(authorize = vi.fn().mockResolvedValue(undefined)) {
  const out: string[] = [];
  const err: string[] = [];
  const config = { accounts: [{ id: 'personal' }, { id: 'work' }] } as unknown as JarvisConfig;
  const deps: CliDeps = {
    loadConfig: () => config,
    createAuthorizer: () => ({ authorizeInteractive: authorize }),
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      throw new ExitCalled(code);
    },
  };
  const run = (...args: string[]) => buildProgram(deps).parseAsync(['node', 'jarvis', ...args]);
  return { run, out, err, authorize };
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
});
