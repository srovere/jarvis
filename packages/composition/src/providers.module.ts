import { resolve } from 'node:path';
import {
  closeDb,
  createDb,
  DrizzleAccountRepository,
  DrizzleEventRepository,
  DrizzleMailRepository,
  DrizzleSettingsRepository,
  DrizzleSyncRequests,
  DrizzleSyncStateRepository,
  DrizzleTaskRepository,
  NullPersonLinkLookup,
  type Db,
} from '@jarvis/adapters-persistence';
import {
  FileTokenStore,
  GoogleAccountConnector,
  GoogleClientSecretStore,
  GoogleOAuthFlow,
  GoogleProviderFactory,
  htmlToPlainText,
} from '@jarvis/adapters-google';
import { ClaudeCliRunner, FileAgentCredentialStore, FileAgentStatusStore } from '@jarvis/adapters-claude';
import type { JarvisConfig } from '@jarvis/config';
import {
  AGENT_PROVIDERS,
  MAIL_PROVIDERS,
  BlockFocusTime,
  CompleteTask,
  ConnectAccount,
  ConnectAgent,
  CreateDraft,
  CreateTask,
  EmailCleaner,
  FindFreeSlot,
  FocusSlotSearch,
  GetDailyBriefing,
  GetSyncStatus,
  ListCalendars,
  ListEvents,
  ListTaskLists,
  ListTasks,
  PriorityRules,
  ProviderRegistry,
  ReadThread,
  RemoveAccount,
  RequestSync,
  SearchEmails,
  SetBusyCalendars,
  SyncAccount,
  TOKENS,
  type AccountConnector,
  type AccountRepository,
  type AgentCredentialStore,
  type AgentRunner,
  type AgentStatusStore,
  type Clock,
  type SettingsStore,
} from '@jarvis/core';
import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Provider,
  type Type,
} from '@nestjs/common';
import { preferencesFromConfig } from './app-settings';
import { LayeredSettings } from './layered-settings';
import { authPaths } from './paths';
import { SystemClock } from './system-clock';
import { DB, GOOGLE_CLIENT_STATUS, JARVIS_CONFIG, JARVIS_CONFIG_PRESENT, LOG_SINK, stderrLogSink } from './tokens';

export interface ProvidersModuleOptions {
  readonly config: JarvisConfig;
  /** Directory of the configuration file; base of relative `secretsDir`/`dataDir`. */
  readonly configDir: string;
  readonly databaseUrl: string;
  /** `false` when there is no YAML file: `config` then holds defaults and is not a settings layer. Default `true`. */
  readonly configPresent?: boolean;
}

/** Providers bound to an explicit token (not bare classes), so they can be exported by token. */
type TokenProvider = Exclude<Provider, Type>;

/** `new type(...resolved inject)` bound to `provide`; constructor arguments are matched by `inject`. */
function construct<T>(provide: symbol, type: Type<T>, inject: symbol[]): TokenProvider {
  return { provide, useFactory: (...deps: unknown[]) => new type(...deps), inject };
}

const T = TOKENS;

/**
 * Composition root shared by the apps: binds every port, domain service and use case to its `TOKENS` entry
 * with the concrete adapters (Postgres via Drizzle, Google APIs). Closes the database on shutdown.
 */
@Module({})
export class ProvidersModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    const { config, configDir, databaseUrl } = options;
    const configPresent = options.configPresent ?? true;
    const dataDir = () => process.env.JARVIS_DATA_DIR?.trim() || '/data';
    const providers: TokenProvider[] = [
      { provide: JARVIS_CONFIG, useValue: config },
      { provide: JARVIS_CONFIG_PRESENT, useValue: configPresent },
      { provide: LOG_SINK, useValue: stderrLogSink },
      { provide: DB, useFactory: () => createDb(databaseUrl) },
      { provide: T.Clock, useClass: SystemClock },
      construct(T.AccountRepository, DrizzleAccountRepository, [DB]),
      construct(T.SettingsStore, DrizzleSettingsRepository, [DB]),
      {
        provide: T.SettingsProvider,
        useFactory: (store: SettingsStore, accounts: AccountRepository, clock: Clock) =>
          new LayeredSettings(store, accounts, configPresent ? preferencesFromConfig(config) : null, clock),
        inject: [T.SettingsStore, T.AccountRepository, T.Clock],
      },
      construct(T.SyncStateRepository, DrizzleSyncStateRepository, [DB]),
      construct(T.SyncRequests, DrizzleSyncRequests, [DB]),
      construct(T.MailRepository, DrizzleMailRepository, [DB]),
      construct(T.EventRepository, DrizzleEventRepository, [DB]),
      construct(T.TaskRepository, DrizzleTaskRepository, [DB]),
      { provide: T.PersonLinkLookup, useClass: NullPersonLinkLookup },
      { provide: GOOGLE_AUTH, useFactory: () => buildGoogleAuth(config, configDir, process.env.JARVIS_DATA_DIR) },
      { provide: T.ProviderRegistry, useFactory: (g: GoogleAuth) => g.registry, inject: [GOOGLE_AUTH] },
      { provide: GOOGLE_CLIENT_STATUS, useFactory: (g: GoogleAuth) => g.secrets, inject: [GOOGLE_AUTH] },
      { provide: T.MailProviders, useValue: MAIL_PROVIDERS },
      { provide: T.AccountConnectors, useFactory: (g: GoogleAuth) => [g.connector], inject: [GOOGLE_AUTH] },
      construct(T.ConnectAccount, ConnectAccount, [T.AccountConnectors, T.AccountRepository, T.ProviderRegistry]),
      construct(T.RemoveAccount, RemoveAccount, [T.AccountConnectors, T.AccountRepository, T.ProviderRegistry]),
      { provide: AGENT_CREDENTIALS, useFactory: () => new FileAgentCredentialStore(dataDir()) },
      { provide: AGENT_STATUS, useFactory: () => new FileAgentStatusStore(dataDir()) },
      {
        provide: T.AgentRunners,
        useFactory: (credentials: FileAgentCredentialStore): AgentRunner[] => [
          new ClaudeCliRunner({ tokens: credentials }),
        ],
        inject: [AGENT_CREDENTIALS],
      },
      { provide: T.AgentProviders, useValue: AGENT_PROVIDERS },
      {
        provide: T.ConnectAgent,
        useFactory: (runners: AgentRunner[], credentials: AgentCredentialStore, status: AgentStatusStore, clock: Clock) =>
          new ConnectAgent(runners, credentials, status, clock),
        inject: [T.AgentRunners, AGENT_CREDENTIALS, AGENT_STATUS, T.Clock],
      },
      construct(T.SetBusyCalendars, SetBusyCalendars, [T.AccountRepository]),
      {
        provide: T.EmailCleaner,
        useFactory: () => new EmailCleaner({ maxChars: config.email.maxBodyChars, htmlToText: htmlToPlainText }),
      },
      construct(T.PriorityRules, PriorityRules, [T.PersonLinkLookup]),
      construct(T.FocusSlotSearch, FocusSlotSearch, [T.AccountRepository, T.EventRepository, T.Clock]),
      construct(T.SyncAccount, SyncAccount, [
        T.AccountRepository,
        T.ProviderRegistry,
        T.SyncStateRepository,
        T.MailRepository,
        T.EventRepository,
        T.TaskRepository,
        T.Clock,
        T.SettingsProvider,
        LOG_SINK,
      ]),
      construct(T.SearchEmails, SearchEmails, [T.AccountRepository, T.ProviderRegistry, T.EmailCleaner, T.SettingsProvider]),
      construct(T.ReadThread, ReadThread, [T.AccountRepository, T.ProviderRegistry, T.EmailCleaner, T.SettingsProvider]),
      construct(T.GetDailyBriefing, GetDailyBriefing, [
        T.AccountRepository,
        T.ProviderRegistry,
        T.MailRepository,
        T.EventRepository,
        T.TaskRepository,
        T.PriorityRules,
        T.EmailCleaner,
        T.Clock,
        T.SettingsProvider,
      ]),
      construct(T.ListEvents, ListEvents, [T.AccountRepository, T.EventRepository, T.SettingsProvider, T.Clock]),
      construct(T.ListCalendars, ListCalendars, [T.AccountRepository, T.ProviderRegistry]),
      construct(T.ListTaskLists, ListTaskLists, [T.AccountRepository, T.TaskRepository]),
      construct(T.GetSyncStatus, GetSyncStatus, [T.AccountRepository, T.SyncStateRepository]),
      construct(T.RequestSync, RequestSync, [T.AccountRepository, T.SyncRequests]),
      construct(T.ListTasks, ListTasks, [T.AccountRepository, T.TaskRepository, T.SettingsProvider]),
      construct(T.FindFreeSlot, FindFreeSlot, [T.AccountRepository, T.EventRepository, T.Clock, T.SettingsProvider]),
      construct(T.BlockFocusTime, BlockFocusTime, [
        T.AccountRepository,
        T.EventRepository,
        T.FocusSlotSearch,
        T.ProviderRegistry,
        T.SettingsProvider,
      ]),
      construct(T.CreateDraft, CreateDraft, [T.AccountRepository, T.ProviderRegistry]),
      construct(T.CreateTask, CreateTask, [T.AccountRepository, T.TaskRepository, T.ProviderRegistry, T.SettingsProvider]),
      construct(T.CompleteTask, CompleteTask, [
        T.AccountRepository,
        T.TaskRepository,
        T.ProviderRegistry,
        T.SettingsProvider,
      ]),
    ];
    return {
      module: ProvidersModule,
      providers,
      exports: providers.map((p) => p.provide),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await closeDb(this.db);
  }
}

const GOOGLE_AUTH = Symbol('GoogleAuth');
const AGENT_CREDENTIALS = Symbol('AgentCredentials');
const AGENT_STATUS = Symbol('AgentStatus');

export interface GoogleAuth {
  readonly registry: ProviderRegistry;
  readonly connector: AccountConnector;
  readonly flow: GoogleOAuthFlow;
  /** The uploaded OAuth client store (read through `GOOGLE_CLIENT_STATUS`). */
  readonly secrets: GoogleClientSecretStore;
}

/**
 * Google auth wiring. The connector (browser authorization) and the registry's token flow (sync refresh) share one
 * `GoogleClientSecretStore` and one token directory, so tokens are always refreshed with the client that issued them.
 * Token dir follows the existing configuration (`dataDir/tokens`); the client is the uploaded one under
 * `dataDirEnv` (default `/data`) with the phase-1 `secretsDir/google_oauth_client` as fallback.
 */
export function buildGoogleAuth(config: JarvisConfig, configDir: string, dataDirEnv?: string): GoogleAuth {
  const { tokenDir } = authPaths(config, configDir);
  const secrets = new GoogleClientSecretStore({
    dataDir: dataDirEnv?.trim() || '/data',
    legacySecretsDir: resolve(configDir, config.secretsDir),
  });
  const store = new FileTokenStore(tokenDir);
  const flow = new GoogleOAuthFlow(secrets, store);
  const registry = new ProviderRegistry();
  registry.register(new GoogleProviderFactory(flow, config.timezone));
  return { registry, connector: new GoogleAccountConnector(secrets, store), flow, secrets };
}
