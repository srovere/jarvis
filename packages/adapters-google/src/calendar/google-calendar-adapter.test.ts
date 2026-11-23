import { describe, expect, it } from 'vitest';
import { ReauthRequired, TimeRange } from '@jarvis/core';
import { DateTime } from 'luxon';
import { FakeCalendar } from './__fixtures__/fake-calendar';
import { GoogleCalendarAdapter } from './google-calendar-adapter';

const ZONE = 'America/Argentina/Buenos_Aires';
const NOW = DateTime.fromISO('2026-11-23T12:00:00', { zone: ZONE });

function setup(opts: ConstructorParameters<typeof FakeCalendar>[0] = {}) {
  const fake = new FakeCalendar(opts);
  return { fake, adapter: new GoogleCalendarAdapter(fake.asCalendar(), 'acc', ZONE, () => NOW) };
}

const day = new TimeRange(
  DateTime.fromISO('2026-11-24T00:00:00', { zone: ZONE }),
  DateTime.fromISO('2026-11-25T00:00:00', { zone: ZONE }),
);

describe('GoogleCalendarAdapter mapping', () => {
  it('maps all-day events to local midnight..next midnight (end.date exclusive)', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', { id: 'a', summary: 'Feriado', start: { date: '2026-11-24' }, end: { date: '2026-11-25' } });
    const [e] = await adapter.listEvents(day, ['primary']);
    expect(e!.allDay).toBe(true);
    expect(e!.range.start.toISO()).toBe('2026-11-24T00:00:00.000-03:00');
    expect(e!.range.end.toISO()).toBe('2026-11-25T00:00:00.000-03:00');
  });

  it('maps timed events, self response, attendees (skipping unparseable) and video link', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', {
      id: 'b',
      summary: 'Reunión',
      htmlLink: 'https://cal/b',
      start: { dateTime: '2026-11-24T10:00:00-03:00' },
      end: { dateTime: '2026-11-24T11:00:00-03:00' },
      attendees: [
        { email: 'me@x.com', self: true, responseStatus: 'tentative' },
        { email: 'otro@y.com', responseStatus: 'accepted' },
        { email: 'no es un mail', responseStatus: 'accepted' },
      ],
      conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://meet/x' }] },
    });
    const [e] = await adapter.listEvents(day, ['primary']);
    expect(e!.myResponse).toBe('tentative');
    expect(e!.attendees.map((a) => [a.email.address, a.response, a.self])).toEqual([
      ['me@x.com', 'tentative', true],
      ['otro@y.com', 'accepted', false],
    ]);
    expect(e!.videoLink).toBe('https://meet/x');
    expect(e!.htmlLink).toBe('https://cal/b');
    expect(e!.range.start.toMillis()).toBe(DateTime.fromISO('2026-11-24T13:00:00Z').toMillis());
  });

  it('prefers hangoutLink and leaves myResponse undefined without attendees', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', {
      id: 'c',
      start: { dateTime: '2026-11-24T10:00:00-03:00' },
      end: { dateTime: '2026-11-24T11:00:00-03:00' },
      hangoutLink: 'https://meet/h',
    });
    const [e] = await adapter.listEvents(day, ['primary']);
    expect(e!.videoLink).toBe('https://meet/h');
    expect(e!.myResponse).toBeUndefined();
  });
});

describe('GoogleCalendarAdapter robustness', () => {
  it('widens zero-length and negative events to one minute instead of aborting', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', { id: 'z', start: { dateTime: '2026-11-24T10:00:00-03:00' }, end: { dateTime: '2026-11-24T10:00:00-03:00' } });
    fake.seed('primary', { id: 'n', start: { dateTime: '2026-11-24T12:00:00-03:00' }, end: { dateTime: '2026-11-24T11:00:00-03:00' } });
    const events = await adapter.listEvents(day, ['primary']);
    expect(events.map((e) => [e.id, e.range.durationMinutes()]).sort()).toEqual([['n', 1], ['z', 1]]);
    expect((await adapter.sync('primary', null)).changes).toHaveLength(2);
  });

  it('an all-day event without end.date lasts one day', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', { id: 'd', start: { date: '2026-11-24' } });
    const [e] = await adapter.listEvents(day, ['primary']);
    expect(e!.allDay).toBe(true);
    expect(e!.range.end.toISO()).toBe('2026-11-25T00:00:00.000-03:00');
  });
});

describe('GoogleCalendarAdapter sync', () => {
  it('incremental sync follows pages and returns every change', async () => {
    const { fake, adapter } = setup({ pageSize: 1 });
    const first = await adapter.sync('primary', null);
    for (const id of ['a', 'b', 'c']) {
      fake.seed('primary', { id, start: { dateTime: '2026-11-24T10:00:00-03:00' }, end: { dateTime: '2026-11-24T11:00:00-03:00' } });
    }
    const next = await adapter.sync('primary', first.nextCursor);
    expect(next.fullResync).toBe(false);
    expect(next.changes).toHaveLength(3);
  });

  it('full sync uses singleEvents, showDeleted and timeMin = now - 30 days, across pages', async () => {
    const { fake, adapter } = setup({ pageSize: 1 });
    for (const id of ['a', 'b', 'c']) {
      fake.seed('primary', { id, start: { dateTime: '2026-11-24T10:00:00-03:00' }, end: { dateTime: '2026-11-24T11:00:00-03:00' } });
    }
    const r = await adapter.sync('primary', null);
    expect(r.fullResync).toBe(true);
    expect(r.changes).toHaveLength(3);
    const first = fake.calls.eventsList.mock.calls[0]![0];
    expect(first).toMatchObject({ singleEvents: true, showDeleted: true });
    expect(DateTime.fromISO(first.timeMin).toMillis()).toBe(NOW.minus({ days: 30 }).toMillis());
  });

  it('cancelled events become delete changes on incremental sync', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', { id: 'a', start: { dateTime: '2026-11-24T10:00:00-03:00' }, end: { dateTime: '2026-11-24T11:00:00-03:00' } });
    const first = await adapter.sync('primary', null);
    fake.cancel('primary', 'a');
    const next = await adapter.sync('primary', first.nextCursor);
    expect(next.fullResync).toBe(false);
    expect(next.changes).toEqual([{ kind: 'delete', eventId: 'a', calendarId: 'primary' }]);
    expect(fake.calls.eventsList.mock.calls.at(-1)![0].syncToken).toBe(first.nextCursor);
  });

  it('an invalidated syncToken (410) falls back to a full resync', async () => {
    const { fake, adapter } = setup();
    fake.seed('primary', { id: 'a', start: { dateTime: '2026-11-24T10:00:00-03:00' }, end: { dateTime: '2026-11-24T11:00:00-03:00' } });
    const first = await adapter.sync('primary', null);
    fake.invalidateSyncTokens();
    const next = await adapter.sync('primary', first.nextCursor);
    expect(next.fullResync).toBe(true);
    expect(next.changes).toHaveLength(1);
    expect((await adapter.sync('primary', next.nextCursor)).changes).toEqual([]);
  });

  it('translates invalid_grant to ReauthRequired', async () => {
    const { fake, adapter } = setup();
    fake.calls.calendarListList.mockImplementationOnce(() => {
      throw Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } });
    });
    await expect(adapter.listCalendars()).rejects.toBeInstanceOf(ReauthRequired);
  });
});

describe('GoogleCalendarAdapter writes', () => {
  it('createEvent sends ISO with offset, timeZone, opaque transparency and description', async () => {
    const { fake, adapter } = setup();
    const range = new TimeRange(
      DateTime.fromISO('2026-12-01T10:00:00', { zone: 'utc' }),
      DateTime.fromISO('2026-12-01T11:00:00', { zone: 'utc' }),
    );
    const r = await adapter.createEvent({ calendarId: 'primary', title: 'Focus', range, description: 'd', transparency: 'opaque' });
    expect(r.id).not.toBe('');
    expect(r.htmlLink).toContain('calendar.example');
    expect(fake.calls.eventsInsert).toHaveBeenCalledWith({
      calendarId: 'primary',
      requestBody: {
        summary: 'Focus',
        description: 'd',
        start: { dateTime: '2026-12-01T07:00:00.000-03:00', timeZone: ZONE },
        end: { dateTime: '2026-12-01T08:00:00.000-03:00', timeZone: ZONE },
        transparency: 'opaque',
      },
    });
  });
});
