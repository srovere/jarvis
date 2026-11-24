import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  EmailAddress,
  TimeRange,
  type Account,
  type AccountRepository,
  type EventRepository,
  type MailRepository,
  type SyncStateRepository,
  type TaskRepository,
} from '@jarvis/core';
import { addr, buildMessage } from './fixtures';

export interface AccountsContractSetup {
  accounts: AccountRepository;
  mail: MailRepository;
  events: EventRepository;
  tasks: TaskRepository;
  syncState: SyncStateRepository;
}

const account = (id: string, email: string, extra: Partial<Account> = {}): Account => ({
  id,
  provider: 'google',
  email: EmailAddress.parse(email),
  status: 'active',
  busyCalendars: ['primary'],
  missingScopes: [],
  createdVia: 'config',
  ...extra,
});

const START = DateTime.fromISO('2026-11-23T10:00:00Z', { zone: 'utc' });
const WINDOW = new TimeRange(START.minus({ days: 1 }), START.plus({ days: 1 }));

export function describeAccountsContract(name: string, setup: () => Promise<AccountsContractSetup>): void {
  describe(`Accounts contract: ${name}`, () => {
    it('findByEmail ignores case and returns the account whatever its status', async () => {
      const { accounts } = await setup();
      await accounts.upsert(account('personal', 'Me@Example.com', { status: 'disabled' }));
      const found = await accounts.findByEmail(addr('me@example.com'));
      expect(found?.id).toBe('personal');
      expect(found?.status).toBe('disabled');
      expect(await accounts.findByEmail(addr('other@example.com'))).toBeNull();
    });

    it('upsert round-trips busyCalendars, missingScopes and createdVia', async () => {
      const { accounts } = await setup();
      await accounts.upsert(
        account('personal', 'me@example.com', {
          busyCalendars: ['primary', 'team@group'],
          missingScopes: ['https://www.googleapis.com/auth/tasks'],
          createdVia: 'wizard',
        }),
      );
      expect(await accounts.get('personal')).toMatchObject({
        busyCalendars: ['primary', 'team@group'],
        missingScopes: ['https://www.googleapis.com/auth/tasks'],
        createdVia: 'wizard',
      });
    });

    it('statusDetail round-trips and is cleared when the account is upserted active without one', async () => {
      const { accounts } = await setup();
      await accounts.upsert(account('personal', 'me@example.com'));
      await accounts.setStatus('personal', 'needs_reauth', 'invalid_grant');
      expect(await accounts.get('personal')).toMatchObject({ status: 'needs_reauth', statusDetail: 'invalid_grant' });
      await accounts.upsert(account('personal', 'me@example.com', { status: 'active' }));
      const after = await accounts.get('personal');
      expect(after.status).toBe('active');
      expect(after.statusDetail).toBeUndefined();
    });

    it('setBusyCalendars and setMissingScopes round-trip', async () => {
      const { accounts } = await setup();
      await accounts.upsert(account('personal', 'me@example.com'));
      await accounts.setBusyCalendars('personal', ['primary', 'team@group']);
      await accounts.setMissingScopes('personal', ['s1']);
      const a = await accounts.get('personal');
      expect(a.busyCalendars).toEqual(['primary', 'team@group']);
      expect(a.missingScopes).toEqual(['s1']);
    });

    it('setBusyCalendars and setMissingScopes fail for an unknown account', async () => {
      const { accounts } = await setup();
      await expect(accounts.setBusyCalendars('nope', [])).rejects.toThrow(/not found/i);
      await expect(accounts.setMissingScopes('nope', [])).rejects.toThrow(/not found/i);
    });

    it('deleteData removes the synced data of the account and keeps the row and other accounts', async () => {
      const { accounts, mail, events, tasks, syncState } = await setup();
      for (const id of ['a', 'b']) {
        await accounts.upsert(account(id, `${id}@example.com`));
        await mail.applyChanges(id, [
          { kind: 'upsert', message: { ...buildMessage({ id: `m-${id}`, threadId: `t-${id}`, from: 'x@y.com', to: ['me@x.com'], minutes: 0 }), accountId: id } },
        ]);
        await events.applyChanges(id, [
          {
            kind: 'upsert',
            event: {
              id: `e-${id}`,
              accountId: id,
              calendarId: 'primary',
              title: 'Meeting',
              range: new TimeRange(START, START.plus({ hours: 1 })),
              allDay: false,
              blocksTime: true,
              attendees: [],
              status: 'confirmed',
            },
          },
        ]);
        await tasks.upsertLists(id, [{ id: 'l1', accountId: id, title: 'Tasks', isDefault: true }]);
        await tasks.applyChanges(id, 'l1', [
          { kind: 'upsert', task: { id: `k-${id}`, accountId: id, listId: 'l1', title: 'Do', status: 'open', updatedAt: START, deleted: false } },
        ]);
        await syncState.set(id, 'mail', 'cursor', START);
      }

      await accounts.deleteData('a');

      expect((await accounts.get('a')).id).toBe('a');
      expect(await mail.recentThreads('a', { since: START.minus({ years: 1 }), limit: 10 })).toEqual([]);
      expect(await events.inRange(['a'], WINDOW)).toEqual([]);
      expect(await tasks.open({ accountIds: ['a'] })).toEqual([]);
      expect(await tasks.lists(['a'])).toEqual([]);
      expect(await syncState.get('a', 'mail')).toBeNull();

      expect(await mail.recentThreads('b', { since: START.minus({ years: 1 }), limit: 10 })).toHaveLength(1);
      expect(await events.inRange(['b'], WINDOW)).toHaveLength(1);
      expect(await tasks.open({ accountIds: ['b'] })).toHaveLength(1);
      expect(await syncState.get('b', 'mail')).toBe('cursor');
    });
  });
}
