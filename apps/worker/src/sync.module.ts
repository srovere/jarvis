import { ProvidersModule, type ProvidersModuleOptions } from '@jarvis/composition';
import { ImportConfig, TOKENS, type AccountRepository, type SettingsStore } from '@jarvis/core';
import { Module, type DynamicModule } from '@nestjs/common';
import { AccountSyncRunner } from './account-sync-runner';
import { ImportConfigOnStart } from './import-config-on-start';

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
        ImportConfigOnStart,
        AccountSyncRunner,
      ],
      exports: [ProvidersModule, AccountSyncRunner],
    };
  }
}
