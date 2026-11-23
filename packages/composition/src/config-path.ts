import { join } from 'node:path';

/** Configuration file location: `JARVIS_CONFIG`, else `jarvis.config.yaml` in the invocation directory. */
export function defaultConfigPath(env: NodeJS.ProcessEnv, cwd: string): string {
  // `pnpm jarvis` runs with cwd apps/worker; INIT_CWD is the directory pnpm was invoked from.
  return env.JARVIS_CONFIG ?? join(env.INIT_CWD ?? cwd, 'jarvis.config.yaml');
}
