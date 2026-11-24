import { DomainError } from '../../domain/errors';
import type { AccountRepository } from '../../domain/ports/repositories';

/** Chooses the calendars of an account whose events block time. */
export class SetBusyCalendars {
  constructor(private readonly accounts: AccountRepository) {}

  async execute(id: string, calendarIds: string[]): Promise<void> {
    if (calendarIds.length === 0) throw new DomainError('Select at least one busy calendar');
    await this.accounts.get(id); // rejects an unknown account
    await this.accounts.setBusyCalendars(id, [...calendarIds]);
  }
}
