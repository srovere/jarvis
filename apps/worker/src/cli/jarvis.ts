import { join } from 'node:path';
import { FileTokenStore, GoogleOAuthFlow } from '@jarvis/adapters-google';
import { loadConfig, type JarvisConfig } from '@jarvis/config';
import { Command } from 'commander';

export interface Authorizer {
  authorizeInteractive(accountId: string): Promise<void>;
}

export interface CliDeps {
  loadConfig(): JarvisConfig;
  createAuthorizer(config: JarvisConfig): Authorizer;
  out(message: string): void;
  err(message: string): void;
  exit(code: number): never;
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('jarvis').exitOverride().configureOutput({
    writeOut: (s) => deps.out(s.trimEnd()),
    writeErr: (s) => deps.err(s.trimEnd()),
  });

  program
    .command('auth')
    .description('Autoriza una cuenta de Google y guarda su token')
    .requiredOption('--account <id>', 'id de la cuenta definida en la configuración')
    .action(async (opts: { account: string }) => {
      try {
        const config = deps.loadConfig();
        if (!config.accounts.some((a) => a.id === opts.account)) {
          const ids = config.accounts.map((a) => a.id).join(', ') || '(ninguna)';
          throw new Error(`La cuenta "${opts.account}" no existe en la configuración. Cuentas configuradas: ${ids}`);
        }
        await deps.createAuthorizer(config).authorizeInteractive(opts.account);
        deps.out(`Token guardado para ${opts.account}`);
      } catch (error) {
        deps.err(error instanceof Error ? error.message : String(error));
        deps.exit(1);
      }
    });

  return program;
}

export function defaultDeps(): CliDeps {
  return {
    loadConfig: () => loadConfig(process.env.JARVIS_CONFIG ?? './jarvis.config.yaml', process.env),
    createAuthorizer: (config) =>
      new GoogleOAuthFlow(
        join(config.secretsDir, 'google_oauth_client'),
        new FileTokenStore(join(config.dataDir, 'tokens')),
      ),
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
