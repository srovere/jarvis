import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { FileTokenStore, GoogleOAuthFlow } from '@jarvis/adapters-google';
import { closeDb, createDb, runMigrations } from '@jarvis/adapters-persistence';
import {
  authPaths,
  defaultConfigPath,
  JsonLogger,
  requireDatabaseUrl,
  stderrLogSink,
  type AuthPaths,
  type ProvidersModuleOptions,
} from '@jarvis/composition';
import { loadConfig, type JarvisConfig } from '@jarvis/config';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import { AccountSyncRunner, type AccountSyncOutcome } from '../account-sync-runner';
import { SyncModule } from '../sync.module';

export type { AuthPaths };

export interface Authorizer {
  authorizeInteractive(accountId: string): Promise<void>;
}

export interface LoadedConfig {
  readonly config: JarvisConfig;
  /** Directory of the config file; base for relative paths. */
  readonly dir: string;
}

/** A one-shot sync context (the Nest application context in production). */
export interface SyncSession {
  run(accountId?: string): Promise<AccountSyncOutcome[]>;
  close(): Promise<void>;
}

export interface CliDeps {
  loadConfig(): LoadedConfig;
  createAuthorizer(paths: AuthPaths): Authorizer;
  /** `DATABASE_URL`; throws a clear error when missing. */
  databaseUrl(): string;
  migrate(databaseUrl: string): Promise<void>;
  openSync(options: ProvidersModuleOptions): Promise<SyncSession>;
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
    .description('Authorize a Google account and store its token')
    .requiredOption('--account <id>', 'account id as defined in the config')
    .action(async (opts: { account: string }) => {
      try {
        const { config, dir } = deps.loadConfig();
        if (!config.accounts.some((a) => a.id === opts.account)) {
          const ids = config.accounts.map((a) => a.id).join(', ') || '(ninguna)';
          throw new Error(`Account "${opts.account}" is not in the config. Configured accounts: ${ids}`);
        }
        await deps.createAuthorizer(authPaths(config, dir)).authorizeInteractive(opts.account);
        deps.out(`Token saved for ${opts.account}`);
      } catch (error) {
        fail(deps, error);
      }
    });

  program
    .command('migrate')
    .description('Apply pending database migrations (DATABASE_URL)')
    .action(async () => {
      try {
        await deps.migrate(deps.databaseUrl());
        deps.out('Migraciones aplicadas');
      } catch (error) {
        fail(deps, error);
      }
    });

  program
    .command('sync')
    .description('Sync the active accounts once and print a JSON summary')
    .option('--once', 'a single run (required; the worker syncs periodically)')
    .option('--account <id>', 'only this account (must be active)')
    .action(async (opts: { once?: boolean; account?: string }) => {
      let outcomes: AccountSyncOutcome[];
      try {
        if (!opts.once) throw new Error('Use "sync --once": periodic sync is done by the worker');
        const { config, dir } = deps.loadConfig();
        const session = await deps.openSync({ config, configDir: dir, databaseUrl: deps.databaseUrl() });
        try {
          outcomes = await session.run(opts.account);
        } finally {
          await session.close();
        }
      } catch (error) {
        return fail(deps, error);
      }
      deps.out(JSON.stringify({ accounts: outcomes }));
      if (outcomes.some(failed)) deps.exit(1);
    });

  return program;
}

function fail(deps: CliDeps, error: unknown): never {
  deps.err(error instanceof Error ? error.message : String(error));
  return deps.exit(1);
}

/** The account's sync aborted, or one of its resources failed. */
function failed(o: AccountSyncOutcome): boolean {
  return o.error !== undefined || Object.values(o.result?.resources ?? {}).includes('error');
}

export function defaultDeps(): CliDeps {
  return {
    loadConfig: () => {
      const path = resolve(defaultConfigPath(process.env, process.cwd()));
      return { config: loadConfig(path, process.env), dir: dirname(path) };
    },
    createAuthorizer: ({ clientSecretPath, tokenDir }) =>
      new GoogleOAuthFlow(clientSecretPath, new FileTokenStore(tokenDir)),
    databaseUrl: () => requireDatabaseUrl(process.env),
    migrate: async (url) => {
      const db = createDb(url);
      try {
        await runMigrations(db);
      } finally {
        await closeDb(db);
      }
    },
    openSync: async (options) => {
      const app = await NestFactory.createApplicationContext(SyncModule.forRoot(options), {
        logger: new JsonLogger(stderrLogSink),
      });
      return { run: (accountId) => app.get(AccountSyncRunner).run(accountId), close: () => app.close() };
    },
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
