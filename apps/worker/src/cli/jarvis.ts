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
import { loadOptionalConfig, type JarvisConfig } from '@jarvis/config';
import { TOKENS, type Account, type AuthorizationStart, type ConnectAccount } from '@jarvis/core';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import { AccountSyncRunner, type AccountSyncOutcome } from '../account-sync-runner';
import { SyncModule } from '../sync.module';

export type { AuthPaths };

/** Receives the browser authorization through a loopback callback server. */
export interface Authorizer {
  receiveAuthorizationCode(
    begin: (redirectUri: string) => Promise<AuthorizationStart>,
  ): Promise<{ code: string; redirectUri: string; verifier: string }>;
}

/** `ConnectAccount` with a one-shot application context behind it. */
export interface ConnectSession {
  begin: ConnectAccount['begin'];
  complete(
    kind: string,
    input: { code: string; redirectUri: string; verifier: string },
    options: { accountId?: string; createdVia: Account['createdVia'] },
  ): Promise<Account>;
  close(): Promise<void>;
}

export interface LoadedConfig {
  readonly config: JarvisConfig;
  /** Directory of the config file; base for relative paths. */
  readonly dir: string;
  /** `false` when there is no YAML file (`config` then holds the defaults). Default `true`. */
  readonly present?: boolean;
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
  openConnect(options: ProvidersModuleOptions): Promise<ConnectSession>;
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
    .description('Connect a Google account (opens a loopback authorization) and store its token')
    .option('--account <id>', 'account id to use; derived from the email when omitted')
    .action(async (opts: { account?: string }) => {
      try {
        const { config, dir, present } = deps.loadConfig();
        const authorizer = deps.createAuthorizer(authPaths(config, dir));
        const session = await deps.openConnect({
          config,
          configDir: dir,
          configPresent: present ?? true,
          databaseUrl: deps.databaseUrl(),
        });
        try {
          const received = await authorizer.receiveAuthorizationCode((redirectUri) =>
            session.begin('google', redirectUri),
          );
          const account = await session.complete('google', received, {
            ...(opts.account !== undefined ? { accountId: opts.account } : {}),
            createdVia: 'cli',
          });
          deps.out(`Token saved for ${account.id} (${account.email.address})`);
        } finally {
          await session.close();
        }
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
        deps.out('Migrations applied');
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
        const { config, dir, present } = deps.loadConfig();
        const session = await deps.openSync({
          config,
          configDir: dir,
          configPresent: present ?? true,
          databaseUrl: deps.databaseUrl(),
        });
        try {
          outcomes = await session.run(opts.account);
        } finally {
          await session.close();
        }
      } catch (error) {
        return fail(deps, error);
      }
      deps.out(JSON.stringify({ accounts: outcomes }));
      for (const o of outcomes.filter((x) => x.status === 'needs_reauth')) {
        deps.err(`Account ${o.accountId} needs re-authorization: run "jarvis auth --account ${o.accountId}"`);
      }
      if (outcomes.length === 0) deps.err('No active accounts to sync');
      if (outcomes.length === 0 || outcomes.some(failed)) deps.exit(1);
    });

  return program;
}

function fail(deps: CliDeps, error: unknown): never {
  deps.err(error instanceof Error ? error.message : String(error));
  return deps.exit(1);
}

/** The account needs re-authorization, its sync aborted, or one of its resources failed. */
function failed(o: AccountSyncOutcome): boolean {
  return o.status !== 'active' || o.error !== undefined || Object.values(o.result?.resources ?? {}).includes('error');
}

export function defaultDeps(): CliDeps {
  return {
    loadConfig: () => {
      const path = resolve(defaultConfigPath(process.env, process.cwd()));
      const { config, present } = loadOptionalConfig(path, process.env);
      return { config, dir: dirname(path), present };
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
    openConnect: async (options) => {
      const app = await NestFactory.createApplicationContext(SyncModule.forRoot(options), {
        logger: new JsonLogger(stderrLogSink),
      });
      const connect = app.get<ConnectAccount>(TOKENS.ConnectAccount, { strict: false });
      return {
        begin: (kind, redirectUri) => connect.begin(kind, redirectUri),
        complete: (kind, input, o) => connect.complete(kind, input, o),
        close: () => app.close(),
      };
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
