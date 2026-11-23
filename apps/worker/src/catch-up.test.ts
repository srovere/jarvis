import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { CatchUp } from './catch-up';

const now = DateTime.fromISO('2026-11-23T10:00:00Z');

describe('CatchUp.isOverdue', () => {
  it('is overdue when there was never a run', () => {
    expect(CatchUp.isOverdue(null, now, 5)).toBe(true);
  });

  it('is not overdue when the last run is newer than the interval', () => {
    expect(CatchUp.isOverdue(now.minus({ minutes: 4 }), now, 5)).toBe(false);
  });

  it('is overdue when the last run is older than the interval', () => {
    expect(CatchUp.isOverdue(now.minus({ minutes: 6 }), now, 5)).toBe(true);
  });
});
