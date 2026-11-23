import type { DateTime, DurationLike } from 'luxon';
import type { Clock } from '../domain/ports/clock';

export class FixedClock implements Clock {
  constructor(private current: DateTime) {}

  now(): DateTime {
    return this.current;
  }

  set(dt: DateTime): void {
    this.current = dt;
  }

  advance(duration: DurationLike): void {
    this.current = this.current.plus(duration);
  }
}
