import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../model/calendar';
import { TimeRange } from '../model/time-range';
import { FreeSlotFinder } from './free-slot-finder';

const ZONE = 'America/Argentina/Buenos_Aires';
const schedule = { zone: ZONE, startHour: 9, endHour: 19, workDays: [1, 2, 3, 4, 5] };
const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

const event = (
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id: `${start}-${end}`,
  accountId: 'acc',
  calendarId: 'cal',
  title: 'busy',
  range: new TimeRange(at(start), at(end)),
  allDay: false,
  attendees: [],
  status: 'confirmed',
  ...overrides,
});

const find = (
  now: string,
  busy: CalendarEvent[] = [],
  extra: { durationMinutes?: number; preferredStartHour?: number } = {},
) =>
  new FreeSlotFinder(schedule).find({
    now: at(now),
    durationMinutes: extra.durationMinutes ?? 90,
    busy,
    preferredStartHour: extra.preferredStartHour,
    horizonWorkDays: 5,
  });

const iso = (r: TimeRange | null) => (r ? [r.start.toISO(), r.end.toISO()] : null);

describe('FreeSlotFinder', () => {
  it('returns the start of the workday on an empty calendar', () => {
    expect(iso(find('2026-11-23T08:00:00'))).toEqual([
      at('2026-11-23T09:00:00').toISO(),
      at('2026-11-23T10:30:00').toISO(),
    ]);
  });

  it('rounds now up to 15 minutes and skips gaps that are too short', () => {
    const r = find('2026-11-23T10:07:00', [event('2026-11-23T10:30:00', '2026-11-23T12:00:00')]);
    expect(iso(r)).toEqual([
      at('2026-11-23T12:00:00').toISO(),
      at('2026-11-23T13:30:00').toISO(),
    ]);
  });

  it('rounds seconds up (10:00:30 -> 10:15) and keeps exact multiples', () => {
    expect(find('2026-11-23T10:00:30')?.start.toISO()).toBe(at('2026-11-23T10:15:00').toISO());
    expect(find('2026-11-23T10:15:00')?.start.toISO()).toBe(at('2026-11-23T10:15:00').toISO());
  });

  it('skips the weekend', () => {
    expect(find('2026-11-27T18:00:00')?.start.toISO()).toBe(at('2026-11-30T09:00:00').toISO());
  });

  it('treats an all-day event as blocking the whole day', () => {
    const r = find('2026-11-23T08:00:00', [
      event('2026-11-23T00:00:00', '2026-11-24T00:00:00', { allDay: true }),
    ]);
    expect(r?.start.toISO()).toBe(at('2026-11-24T09:00:00').toISO());
  });

  it('clips an event crossing midnight to the window', () => {
    const r = find('2026-11-23T08:00:00', [event('2026-11-22T22:00:00', '2026-11-23T10:00:00')]);
    expect(iso(r)).toEqual([
      at('2026-11-23T10:00:00').toISO(),
      at('2026-11-23T11:30:00').toISO(),
    ]);
  });

  it('ignores declined events', () => {
    const r = find('2026-11-23T08:00:00', [
      event('2026-11-23T09:00:00', '2026-11-23T12:00:00', { myResponse: 'declined' }),
    ]);
    expect(r?.start.toISO()).toBe(at('2026-11-23T09:00:00').toISO());
  });

  it('ignores cancelled events', () => {
    const r = find('2026-11-23T08:00:00', [
      event('2026-11-23T09:00:00', '2026-11-23T12:00:00', { status: 'cancelled' }),
    ]);
    expect(r?.start.toISO()).toBe(at('2026-11-23T09:00:00').toISO());
  });

  it('honors preferredStartHour on the first day', () => {
    const r = find('2026-11-23T08:00:00', [], { preferredStartHour: 15 });
    expect(iso(r)).toEqual([
      at('2026-11-23T15:00:00').toISO(),
      at('2026-11-23T16:30:00').toISO(),
    ]);
  });

  it('uses startHour (not preferredStartHour) on following days', () => {
    const r = find('2026-11-23T08:00:00', [event('2026-11-23T00:00:00', '2026-11-24T00:00:00', { allDay: true })], {
      preferredStartHour: 15,
    });
    expect(r?.start.toISO()).toBe(at('2026-11-24T09:00:00').toISO());
  });

  it('returns null when every work day is full', () => {
    const busy = ['23', '24', '25', '26', '27'].map((d) =>
      event(`2026-11-${d}T09:00:00`, `2026-11-${d}T19:00:00`),
    );
    expect(find('2026-11-23T08:00:00', busy)).toBeNull();
  });

  it('returns null when the duration exceeds the workday', () => {
    expect(find('2026-11-23T08:00:00', [], { durationMinutes: 660 })).toBeNull();
  });

  it('returns the slot in the schedule zone', () => {
    const r = new FreeSlotFinder(schedule).find({
      now: DateTime.fromISO('2026-11-23T11:00:00Z', { zone: 'UTC' }),
      durationMinutes: 60,
      busy: [],
      horizonWorkDays: 5,
    });
    expect(r?.start.zoneName).toBe(ZONE);
    expect(r?.start.toISO()).toBe(at('2026-11-23T09:00:00').toISO());
  });
});
