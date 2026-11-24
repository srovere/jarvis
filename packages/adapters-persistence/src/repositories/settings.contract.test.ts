import { describeSettingsContract } from '@jarvis/contracts';
import { useTestDb } from '../test-db.test-support';
import { DrizzleSettingsRepository } from './settings.repository';

const t = useTestDb();

describeSettingsContract('DrizzleSettingsRepository', async () => new DrizzleSettingsRepository(t.db()));
