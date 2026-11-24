import { beforeEach, describe, expect, it } from 'vitest';
import { staticSettings, event, UseCaseFixture } from './use-case-fixture.test-support';
import { ListEvents } from './list-events';

describe('ListEvents', () => {
  let f: UseCaseFixture;
  const useCase = () => new ListEvents(f.repos.accounts, f.repos.events, staticSettings());

  beforeEach(async () => {
    f = new UseCaseFixture();
    await f.addAccount('a1');
    await f.addAccount('off', 'needs_reauth');
    await f.repos.events.applyChanges('a1', [
      { kind: 'upsert', event: event('in', 'a1', '2026-11-24T10:00:00', '2026-11-24T11:00:00') },
      { kind: 'upsert', event: event('declined', 'a1', '2026-11-24T12:00:00', '2026-11-24T13:00:00', { myResponse: 'declined' }) },
      { kind: 'upsert', event: event('out', 'a1', '2026-11-26T10:00:00', '2026-11-26T11:00:00') },
    ]);
    await f.repos.events.applyChanges('off', [{ kind: 'upsert', event: event('off', 'off', '2026-11-24T10:00:00', '2026-11-24T11:00:00') }]);
  });

  it('returns stored events of active accounts in the range as zoned views', async () => {
    const got = await useCase().execute({ from: '2026-11-24T00:00:00-03:00', to: '2026-11-25T00:00:00-03:00' });
    expect(got).toEqual([
      { id: 'in', title: 'Event in', start: '2026-11-24T10:00:00.000-03:00', end: '2026-11-24T11:00:00.000-03:00', allDay: false, attendees: [] },
    ]);
  });

  it('interprets offset-less ISO in the configured zone', async () => {
    const got = await useCase().execute({ from: '2026-11-24T10:30:00', to: '2026-11-24T10:45:00' });
    expect(got.map((e) => e.id)).toEqual(['in']);
  });

  it('rejects an invalid date', async () => {
    await expect(useCase().execute({ from: 'nope', to: '2026-11-25' })).rejects.toThrow('Invalid date: nope');
  });
});
