import { ProvidersModule, type ProvidersModuleOptions } from '@jarvis/composition';
import { Module, type DynamicModule } from '@nestjs/common';
import { AccountSyncRunner } from './account-sync-runner';
import { ConfigAccountSeeder } from './config-account-seeder';

/** Providers plus what any sync needs: the configured accounts upserted on init and the account runner. */
@Module({})
export class SyncModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    return {
      module: SyncModule,
      imports: [ProvidersModule.forRoot(options)],
      providers: [ConfigAccountSeeder, AccountSyncRunner],
      exports: [ProvidersModule, AccountSyncRunner],
    };
  }
}
