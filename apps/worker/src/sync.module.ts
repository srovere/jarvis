import { ProvidersModule, type ProvidersModuleOptions } from '@jarvis/composition';
import { ImportConfig, TOKENS, type AccountRepository, type SettingsStore, type SyncRequests } from '@jarvis/core';
import { Module, type DynamicModule } from '@nestjs/common';
import { AccountSyncRunner } from './account-sync-runner';
import { ImportConfigOnStart } from './import-config-on-start';
import { SYNC_REQUESTS } from './sync.scheduler';

/** Sync requests need a store (Task 8); until then no account ever has a pending request. */
const noSyncRequests: SyncRequests = { pending: async () => [], clear: async () => undefined };

/** Providers plus what any sync needs: the one-time config import on init and the account runner. */
@Module({})
export class SyncModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    return {
      module: SyncModule,
      imports: [ProvidersModule.forRoot(options)],
      providers: [
        {
          provide: ImportConfig,
          useFactory: (accounts: AccountRepository, settings: SettingsStore) => new ImportConfig(accounts, settings),
          inject: [TOKENS.AccountRepository, TOKENS.SettingsStore],
        },
        { provide: SYNC_REQUESTS, useValue: noSyncRequests },
        ImportConfigOnStart,
        AccountSyncRunner,
      ],
      exports: [ProvidersModule, AccountSyncRunner, SYNC_REQUESTS],
    };
  }
}
