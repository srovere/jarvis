import { beforeEach, describe, expect, it } from 'vitest';
import { CALENDAR_LIST_SCOPE } from '../../domain/model/account';
import { ListCalendars } from './list-calendars';
import { UseCaseFixture } from './use-case-fixture.test-support';

describe('ListCalendars', () => {
  let f: UseCaseFixture;
  const useCase = () => new ListCalendars(f.repos.accounts, f.registry);

  beforeEach(async () => {
    f = new UseCaseFixture();
    const a1 = await f.addAccount('a1');
    a1.calendar.seedCalendars([
      { id: 'a1@x.com', title: 'Me', primary: true },
      { id: 'team', title: 'Team', primary: false },
    ]);
    await f.repos.accounts.setBusyCalendars('a1', ['a1@x.com']);
    await f.addAccount('off', 'needs_reauth');
  });

  it('lists the live calendars of every active account, flagging the busy ones', async () => {
    const got = await useCase().execute({});
    expect(got).toEqual([
      { accountId: 'a1', id: 'a1@x.com', title: 'Me', primary: true, busy: true },
      { accountId: 'a1', id: 'team', title: 'Team', primary: false, busy: false },
    ]);
  });

  it('returns only primary with missingScope when the calendar-list scope was not granted', async () => {
    await f.repos.accounts.setMissingScopes('a1', [CALENDAR_LIST_SCOPE]);
    const got = await useCase().execute({ accountId: 'a1' });
    expect(got).toEqual([{ accountId: 'a1', id: 'primary', title: 'primary', primary: true, busy: false, missingScope: true }]);
  });

  it('marks the primary stand-in busy when it is configured as busy', async () => {
    await f.repos.accounts.setMissingScopes('a1', [CALENDAR_LIST_SCOPE]);
    await f.repos.accounts.setBusyCalendars('a1', ['primary']);
    expect((await useCase().execute({}))[0]).toMatchObject({ id: 'primary', busy: true, missingScope: true });
  });

  it('rejects an unknown or non-active account', async () => {
    await expect(useCase().execute({ accountId: 'nope' })).rejects.toThrow('Account not active: nope');
    await expect(useCase().execute({ accountId: 'off' })).rejects.toThrow('Account not active: off');
  });
});
