import { join, dirname, resolve } from 'node:path';
import { FileTokenStore, GoogleOAuthFlow } from '@jarvis/adapters-google';
import { loadConfig, type JarvisConfig } from '@jarvis/config';
import { Command } from 'commander';

export interface Authorizer {
  authorizeInteractive(accountId: string): Promise<void>;
}

export interface LoadedConfig {
  readonly config: JarvisConfig;
  /** Directorio del archivo de configuración; base de las rutas relativas. */
  readonly dir: string;
}

export interface AuthPaths {
  readonly clientSecretPath: string;
  readonly tokenDir: string;
}

export interface CliDeps {
  loadConfig(): LoadedConfig;
  createAuthorizer(paths: AuthPaths): Authorizer;
  out(message: string): void;
  err(message: string): void;
  exit(code: number): never;
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('jarvis').exitOverride((e) => deps.exit(e.exitCode)).configureOutput({
    writeOut: (s) => deps.out(s.trimEnd()),
    writeErr: (s) => deps.err(s.trimEnd()),
  });

  program
    .command('auth')
    .description('Autoriza una cuenta de Google y guarda su token')
    .requiredOption('--account <id>', 'id de la cuenta definida en la configuración')
    .action(async (opts: { account: string }) => {
      try {
        const { config, dir } = deps.loadConfig();
        if (!config.accounts.some((a) => a.id === opts.account)) {
          const ids = config.accounts.map((a) => a.id).join(', ') || '(ninguna)';
          throw new Error(`La cuenta "${opts.account}" no existe en la configuración. Cuentas configuradas: ${ids}`);
        }
        const paths: AuthPaths = {
          clientSecretPath: resolve(dir, config.secretsDir, 'google_oauth_client'),
          tokenDir: resolve(dir, config.dataDir, 'tokens'),
        };
        await deps.createAuthorizer(paths).authorizeInteractive(opts.account);
        deps.out(`Token guardado para ${opts.account}`);
      } catch (error) {
        deps.err(error instanceof Error ? error.message : String(error));
        deps.exit(1);
      }
    });

  return program;
}

export function defaultConfigPath(env: NodeJS.ProcessEnv, cwd: string): string {
  // `pnpm jarvis` corre con cwd en apps/worker; INIT_CWD es el directorio desde el que se invocó pnpm.
  return env.JARVIS_CONFIG ?? join(env.INIT_CWD ?? cwd, 'jarvis.config.yaml');
}

export function defaultDeps(): CliDeps {
  return {
    loadConfig: () => {
      const path = resolve(defaultConfigPath(process.env, process.cwd()));
      return { config: loadConfig(path, process.env), dir: dirname(path) };
    },
    createAuthorizer: ({ clientSecretPath, tokenDir }) =>
      new GoogleOAuthFlow(clientSecretPath, new FileTokenStore(tokenDir)),
    out: (m) => process.stdout.write(`${m}\n`),
    err: (m) => process.stderr.write(`${m}\n`),
    exit: (code) => process.exit(code),
  };
}

if (require.main === module) {
  buildProgram(defaultDeps())
    .parseAsync(process.argv)
    .catch(() => process.exit(1));
}
