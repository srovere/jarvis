import type { ProvidersModuleOptions } from '@jarvis/composition';
import { Module, type DynamicModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SYNC_SCHEDULER_OPTIONS, SyncScheduler, type SyncSchedulerOptions } from './sync.scheduler';
import { SyncModule } from './sync.module';

/** The long-running worker: periodic sync of every active account. */
@Module({})
export class AppModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    const schedule: SyncSchedulerOptions = { intervalMinutes: options.config.sync.intervalMinutes };
    return {
      module: AppModule,
      imports: [SyncModule.forRoot(options), ScheduleModule.forRoot()],
      providers: [{ provide: SYNC_SCHEDULER_OPTIONS, useValue: schedule }, SyncScheduler],
    };
  }
}
