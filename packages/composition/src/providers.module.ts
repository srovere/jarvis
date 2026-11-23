import {
  closeDb,
  createDb,
  DrizzleAccountRepository,
  DrizzleEventRepository,
  DrizzleMailRepository,
  DrizzleSyncStateRepository,
  DrizzleTaskRepository,
  NullPersonLinkLookup,
  type Db,
} from '@jarvis/adapters-persistence';
import { FileTokenStore, GoogleOAuthFlow, GoogleProviderFactory, htmlToPlainText } from '@jarvis/adapters-google';
import type { JarvisConfig } from '@jarvis/config';
import {
  BlockFocusTime,
  CompleteTask,
  CreateDraft,
  CreateTask,
  EmailCleaner,
  FindFreeSlot,
  FocusSlotSearch,
  FreeSlotFinder,
  GetDailyBriefing,
  ListEvents,
  ListTasks,
  PriorityRules,
  ProviderRegistry,
  ReadThread,
  SearchEmails,
  SyncAccount,
  TOKENS,
  type AppSettings,
} from '@jarvis/core';
import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Provider,
  type Type,
} from '@nestjs/common';
import { toAppSettings } from './app-settings';
import { authPaths } from './paths';
import { SystemClock } from './system-clock';
import { DB, JARVIS_CONFIG, LOG_SINK, stderrLogSink } from './tokens';

export interface ProvidersModuleOptions {
  readonly config: JarvisConfig;
  /** Directory of the configuration file; base of relative `secretsDir`/`dataDir`. */
  readonly configDir: string;
  readonly databaseUrl: string;
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
    const providers: TokenProvider[] = [
      { provide: JARVIS_CONFIG, useValue: config },
      { provide: LOG_SINK, useValue: stderrLogSink },
      { provide: DB, useFactory: () => createDb(databaseUrl) },
      { provide: T.AppSettings, useValue: toAppSettings(config) },
      { provide: T.Clock, useClass: SystemClock },
      construct(T.AccountRepository, DrizzleAccountRepository, [DB]),
      construct(T.SyncStateRepository, DrizzleSyncStateRepository, [DB]),
      construct(T.MailRepository, DrizzleMailRepository, [DB]),
      construct(T.EventRepository, DrizzleEventRepository, [DB]),
      construct(T.TaskRepository, DrizzleTaskRepository, [DB]),
      { provide: T.PersonLinkLookup, useClass: NullPersonLinkLookup },
      { provide: T.ProviderRegistry, useFactory: () => googleRegistry(config, configDir) },
      {
        provide: T.EmailCleaner,
        useFactory: () => new EmailCleaner({ maxChars: config.email.maxBodyChars, htmlToText: htmlToPlainText }),
      },
      {
        provide: T.FreeSlotFinder,
        useFactory: (s: AppSettings) => new FreeSlotFinder(s.workSchedule),
        inject: [T.AppSettings],
      },
      construct(T.PriorityRules, PriorityRules, [T.PersonLinkLookup]),
      construct(T.FocusSlotSearch, FocusSlotSearch, [
        T.AccountRepository,
        T.EventRepository,
        T.FreeSlotFinder,
        T.Clock,
        T.AppSettings,
      ]),
      construct(T.SyncAccount, SyncAccount, [
        T.AccountRepository,
        T.ProviderRegistry,
        T.SyncStateRepository,
        T.MailRepository,
        T.EventRepository,
        T.TaskRepository,
        T.Clock,
        T.AppSettings,
        LOG_SINK,
      ]),
      construct(T.SearchEmails, SearchEmails, [T.AccountRepository, T.ProviderRegistry, T.EmailCleaner, T.AppSettings]),
      construct(T.ReadThread, ReadThread, [T.AccountRepository, T.ProviderRegistry, T.EmailCleaner, T.AppSettings]),
      construct(T.GetDailyBriefing, GetDailyBriefing, [
        T.AccountRepository,
        T.ProviderRegistry,
        T.MailRepository,
        T.EventRepository,
        T.TaskRepository,
        T.PriorityRules,
        T.EmailCleaner,
        T.Clock,
        T.AppSettings,
      ]),
      construct(T.ListEvents, ListEvents, [T.AccountRepository, T.EventRepository, T.AppSettings]),
      construct(T.ListTasks, ListTasks, [T.AccountRepository, T.TaskRepository, T.AppSettings]),
      construct(T.FindFreeSlot, FindFreeSlot, [
        T.AccountRepository,
        T.EventRepository,
        T.FreeSlotFinder,
        T.Clock,
        T.AppSettings,
      ]),
      construct(T.BlockFocusTime, BlockFocusTime, [
        T.AccountRepository,
        T.EventRepository,
        T.FocusSlotSearch,
        T.ProviderRegistry,
        T.AppSettings,
      ]),
      construct(T.CreateDraft, CreateDraft, [T.AccountRepository, T.ProviderRegistry]),
      construct(T.CreateTask, CreateTask, [T.AccountRepository, T.TaskRepository, T.ProviderRegistry, T.AppSettings]),
      construct(T.CompleteTask, CompleteTask, [
        T.AccountRepository,
        T.TaskRepository,
        T.ProviderRegistry,
        T.AppSettings,
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

function googleRegistry(config: JarvisConfig, configDir: string): ProviderRegistry {
  const { clientSecretPath, tokenDir } = authPaths(config, configDir);
  const registry = new ProviderRegistry();
  const oauth = new GoogleOAuthFlow(clientSecretPath, new FileTokenStore(tokenDir));
  registry.register(new GoogleProviderFactory(oauth, config.timezone));
  return registry;
}
