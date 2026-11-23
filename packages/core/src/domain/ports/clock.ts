import type { DateTime } from 'luxon';

export interface Clock {
  now(): DateTime;
}
