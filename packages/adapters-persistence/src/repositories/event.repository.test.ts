import { EmailAddress, TimeRange, type CalendarEvent } from '@jarvis/core';
import { count } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../schema';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleEventRepository } from './event.repository';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

function ev(id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    accountId: 'personal',
    calendarId: 'primary',
    title: `Event ${id}`,
    range: new TimeRange(at(start), at(end)),
    allDay: false,
    attendees: [],
    status: 'confirmed',
    ...extra,
  };
}

describe('DrizzleEventRepository', () => {
  const t = useTestDb();
  let repo: DrizzleEventRepository;

  beforeEach(async () => {
    const accounts = new DrizzleAccountRepository(t.db());
    for (const id of ['personal', 'work']) {
      await accounts.upsert({ id, provider: 'google', email: EmailAddress.parse('me@example.com'), status: 'active' });
    }
    repo = new DrizzleEventRepository(t.db());
  });

  it('upsert twice leaves one row; delete removes it', async () => {
    const e = ev('e1', '2026-11-23T10:00:00Z', '2026-11-23T11:00:00Z');
    await repo.applyChanges('personal', [{ kind: 'upsert', event: e }]);
    await repo.applyChanges('personal', [{ kind: 'upsert', event: { ...e, title: 'Renamed' } }]);
    expect((await t.db().select({ n: count() }).from(events))[0]!.n).toBe(1);
    await repo.applyChanges('personal', [{ kind: 'delete', eventId: 'e1', calendarId: 'primary' }]);
    expect((await t.db().select({ n: count() }).from(events))[0]!.n).toBe(0);
  });

  it('inRange includes an event that starts before the range and ends inside it', async () => {
    await repo.applyChanges('personal', [
      { kind: 'upsert', event: ev('early', '2026-11-23T09:30:00Z', '2026-11-23T10:30:00Z') },
      { kind: 'upsert', event: ev('inside', '2026-11-23T11:00:00Z', '2026-11-23T12:00:00Z') },
      { kind: 'upsert', event: ev('before', '2026-11-23T08:00:00Z', '2026-11-23T10:00:00Z') },
      { kind: 'upsert', event: ev('after', '2026-11-23T13:00:00Z', '2026-11-23T14:00:00Z') },
    ]);
    const range = new TimeRange(at('2026-11-23T10:00:00Z'), at('2026-11-23T13:00:00Z'));
    const got = await repo.inRange(['personal'], range);
    expect(got.map((e) => e.id)).toEqual(['early', 'inside']);
  });

  it('round-trips the full domain event and filters by account', async () => {
    const full = ev('e1', '2026-11-23T10:00:00Z', '2026-11-23T11:00:00Z', {
      allDay: true,
      status: 'tentative',
      myResponse: 'accepted',
      videoLink: 'https://meet/x',
      htmlLink: 'https://cal/x',
      attendees: [{ email: EmailAddress.parse('Ana <ana@example.com>'), response: 'accepted', self: false }],
      raw: { etag: '1' },
    });
    await repo.applyChanges('personal', [{ kind: 'upsert', event: full }]);
    const range = new TimeRange(at('2026-11-23T00:00:00Z'), at('2026-11-24T00:00:00Z'));
    const [got] = await repo.inRange(['personal'], range);
    expect(got).toMatchObject({
      id: 'e1',
      accountId: 'personal',
      calendarId: 'primary',
      allDay: true,
      status: 'tentative',
      myResponse: 'accepted',
      videoLink: 'https://meet/x',
      htmlLink: 'https://cal/x',
      raw: { etag: '1' },
    });
    expect(got!.range.start.toMillis()).toBe(full.range.start.toMillis());
    expect(got!.attendees[0]).toMatchObject({ response: 'accepted', self: false });
    expect(got!.attendees[0]!.email.address).toBe('ana@example.com');
    expect(await repo.inRange(['work'], range)).toEqual([]);
    expect(await repo.inRange([], range)).toEqual([]);
  });

  it('keeps the same event id in two calendars as separate rows and deletes per calendar', async () => {
    const a = ev('same', '2026-11-23T10:00:00Z', '2026-11-23T11:00:00Z', { calendarId: 'primary' });
    const b = ev('same', '2026-11-23T10:00:00Z', '2026-11-23T11:00:00Z', { calendarId: 'shared' });
    await repo.applyChanges('personal', [{ kind: 'upsert', event: a }, { kind: 'upsert', event: b }]);
    await repo.applyChanges('personal', [{ kind: 'upsert', event: a }, { kind: 'upsert', event: b }]);
    const range = new TimeRange(at('2026-11-23T00:00:00Z'), at('2026-11-24T00:00:00Z'));
    expect((await repo.inRange(['personal'], range)).map((e) => e.calendarId).sort()).toEqual(['primary', 'shared']);
    await repo.applyChanges('personal', [{ kind: 'delete', eventId: 'same', calendarId: 'primary' }]);
    expect((await repo.inRange(['personal'], range)).map((e) => e.calendarId)).toEqual(['shared']);
  });

  it('eventIdsFrom returns ids of the calendar events starting at or after from', async () => {
    await repo.applyChanges('personal', [
      { kind: 'upsert', event: ev('before', '2026-11-22T09:00:00Z', '2026-11-23T11:00:00Z') },
      { kind: 'upsert', event: ev('edge', '2026-11-23T10:00:00Z', '2026-11-23T11:00:00Z') },
      { kind: 'upsert', event: ev('after', '2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z') },
      { kind: 'upsert', event: ev('othercal', '2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z', { calendarId: 'team' }) },
    ]);
    await repo.applyChanges('work', [{ kind: 'upsert', event: ev('work', '2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z', { accountId: 'work' }) }]);
    expect((await repo.eventIdsFrom('personal', 'primary', at('2026-11-23T10:00:00Z'))).sort()).toEqual(['after', 'edge']);
  });
});
