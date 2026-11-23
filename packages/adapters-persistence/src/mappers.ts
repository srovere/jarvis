import { EmailAddress } from '@jarvis/core';
import { DateTime } from 'luxon';
import type { StoredAddress } from './schema';

export const toDate = (d: DateTime): Date => d.toJSDate();

export const toDateOrNull = (d: DateTime | undefined): Date | null => (d ? d.toJSDate() : null);

export const fromDate = (d: Date): DateTime => DateTime.fromJSDate(d, { zone: 'utc' });

export const fromDateOrUndefined = (d: Date | null): DateTime | undefined => (d ? fromDate(d) : undefined);

export const toStoredAddress = (a: EmailAddress): StoredAddress => (a.name ? { address: a.address, name: a.name } : { address: a.address });

export function fromStoredAddress(a: StoredAddress): EmailAddress {
  return EmailAddress.parse(a.name ? `${a.name} <${a.address}>` : a.address);
}
