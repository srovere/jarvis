import { describeTasksContract } from '@jarvis/contracts';
import { FakeTasks } from './__fixtures__/fake-tasks';
import { GoogleTasksAdapter } from './google-tasks-adapter';

describeTasksContract('GoogleTasksAdapter + FakeTasks', async () => {
  const adapter = new GoogleTasksAdapter(new FakeTasks({ pageSize: 1 }).asTasks(), 'contract-account');
  return { reader: adapter, writer: adapter };
});
