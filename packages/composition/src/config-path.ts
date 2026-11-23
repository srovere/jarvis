import { join } from 'node:path';

/** Configuration file location: `JARVIS_CONFIG`, else `jarvis.config.yaml` in the invocation directory. */
export function defaultConfigPath(env: NodeJS.ProcessEnv, cwd: string): string {
  // `pnpm jarvis` corre con cwd en apps/worker; INIT_CWD es el directorio desde el que se invocó pnpm.
  return env.JARVIS_CONFIG ?? join(env.INIT_CWD ?? cwd, 'jarvis.config.yaml');
}
