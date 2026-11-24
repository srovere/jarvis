import { DateTime } from 'luxon';
import { EmailAddress } from '@jarvis/core';
import { FixedClock, InMemoryCalendarProvider, InMemoryRepositories, InMemoryMailProvider, InMemoryTasksProvider } from '@jarvis/core/testing';
import { describeAccountsContract } from './accounts.contract';
import { describeCalendarContract } from './calendar.contract';
import { describeDraftWriterContract } from './draft-writer.contract';
import { FIXTURE_ACCOUNT_ID } from './fixtures';
import { describeMailReaderContract } from './mail-reader.contract';
import { describeTasksContract } from './tasks.contract';

const own = [EmailAddress.parse('me@x.com')];

const mail = () => new InMemoryMailProvider({ accountId: FIXTURE_ACCOUNT_ID, own });

describeMailReaderContract('InMemoryMailProvider', async () => {
  const p = mail();
  return { reader: p, seed: async (threads) => p.seed(threads) };
});

describeDraftWriterContract('InMemoryMailProvider', async () => {
  const p = mail();
  return { writer: p, reader: p, seed: async (threads) => p.seed(threads), own };
});

describeCalendarContract('InMemoryCalendarProvider', async () => {
  const p = new InMemoryCalendarProvider({ accountId: FIXTURE_ACCOUNT_ID });
  return { reader: p, writer: p, calendarId: 'primary', zone: 'America/Argentina/Buenos_Aires' };
});

describeTasksContract('InMemoryTasksProvider', async () => {
  const clock = new FixedClock(DateTime.fromISO('2026-11-23T10:00:00Z'));
  const p = new InMemoryTasksProvider({ accountId: FIXTURE_ACCOUNT_ID, clock });
  return { reader: p, writer: p };
});

describeAccountsContract('InMemoryRepositories', async () => {
  const r = new InMemoryRepositories();
  return { accounts: r.accounts, mail: r.mail, events: r.events, tasks: r.tasks, syncState: r.syncState };
});
