import type { DateTime } from 'luxon';
import { InvalidTimeRange } from '../errors';

/** Half-open interval [start, end). */
export class TimeRange {
  constructor(
    readonly start: DateTime,
    readonly end: DateTime,
  ) {
    if (end.toMillis() <= start.toMillis()) throw new InvalidTimeRange('end must be after start');
  }

  overlaps(o: TimeRange): boolean {
    return this.start < o.end && o.start < this.end;
  }

  contains(t: DateTime): boolean {
    return this.start <= t && t < this.end;
  }

  durationMinutes(): number {
    return this.end.diff(this.start, 'minutes').minutes;
  }
}
