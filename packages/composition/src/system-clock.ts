import type { Clock } from '@jarvis/core';
import { DateTime } from 'luxon';

export class SystemClock implements Clock {
  now(): DateTime {
    return DateTime.now();
  }
}
