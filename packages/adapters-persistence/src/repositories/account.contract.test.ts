import { describeAccountsContract } from '@jarvis/contracts';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleEventRepository } from './event.repository';
import { DrizzleMailRepository } from './mail.repository';
import { DrizzleSyncStateRepository } from './sync-state.repository';
import { DrizzleTaskRepository } from './task.repository';

const t = useTestDb();

describeAccountsContract('Drizzle repositories', async () => ({
  accounts: new DrizzleAccountRepository(t.db()),
  mail: new DrizzleMailRepository(t.db()),
  events: new DrizzleEventRepository(t.db()),
  tasks: new DrizzleTaskRepository(t.db()),
  syncState: new DrizzleSyncStateRepository(t.db()),
}));
