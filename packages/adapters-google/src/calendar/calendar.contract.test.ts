import { describeCalendarContract } from '@jarvis/contracts';
import { FakeCalendar } from './__fixtures__/fake-calendar';
import { GoogleCalendarAdapter } from './google-calendar-adapter';

const ZONE = 'America/Argentina/Buenos_Aires';

describeCalendarContract('GoogleCalendarAdapter + FakeCalendar', async () => {
  const fake = new FakeCalendar({ pageSize: 1 });
  const adapter = new GoogleCalendarAdapter(fake.asCalendar(), 'contract-account', ZONE);
  return { reader: adapter, writer: adapter, calendarId: 'primary', zone: ZONE };
});
