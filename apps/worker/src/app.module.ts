import type { ProvidersModuleOptions } from '@jarvis/composition';
import { Module, type DynamicModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SyncScheduler } from './sync.scheduler';
import { SyncModule } from './sync.module';

/** The long-running worker: periodic sync of every active account. */
@Module({})
export class AppModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [SyncModule.forRoot(options), ScheduleModule.forRoot()],
      providers: [SyncScheduler],
    };
  }
}
