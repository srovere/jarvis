import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { TimeRange } from './time-range';
import { InvalidTimeRange } from '../errors';

const t = (h: number, m = 0) => DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: h, minute: m }, { zone: 'utc' });

describe('TimeRange', () => {
  const r = new TimeRange(t(10), t(11));
  it('is half-open on overlaps', () => {
    expect(r.overlaps(new TimeRange(t(11), t(12)))).toBe(false);
    expect(new TimeRange(t(11), t(12)).overlaps(r)).toBe(false);
    expect(r.overlaps(new TimeRange(t(10, 30), t(11, 30)))).toBe(true);
  });
  it('contains is start <= t < end', () => {
    expect(r.contains(t(10))).toBe(true);
    expect(r.contains(t(11))).toBe(false);
  });
  it('rejects empty or inverted ranges', () => {
    expect(() => new TimeRange(t(10), t(10))).toThrow(InvalidTimeRange);
    expect(() => new TimeRange(t(11), t(10))).toThrow(InvalidTimeRange);
  });
  it('computes duration in minutes', () => {
    expect(new TimeRange(t(9), t(10, 30)).durationMinutes()).toBe(90);
  });
});
