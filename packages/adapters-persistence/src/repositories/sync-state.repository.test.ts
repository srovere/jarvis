import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test-db.test-support';
import { DrizzleAccountRepository } from './account.repository';
import { DrizzleSyncStateRepository } from './sync-state.repository';
import { EmailAddress } from '@jarvis/core';

describe('DrizzleSyncStateRepository', () => {
  const t = useTestDb();

  async function seed() {
    await new DrizzleAccountRepository(t.db()).upsert({
      id: 'personal',
      provider: 'google',
      email: EmailAddress.parse('me@example.com'),
      status: 'active',
    });
    return new DrizzleSyncStateRepository(t.db());
  }

  it('returns null before anything was stored', async () => {
    const repo = await seed();
    expect(await repo.get('personal', 'gmail')).toBeNull();
    expect(await repo.lastRunAt('personal', 'gmail')).toBeNull();
  });

  it('persists and overwrites the cursor per resource', async () => {
    const repo = await seed();
    const at = DateTime.fromISO('2026-11-23T10:00:00Z', { zone: 'utc' });
    await repo.set('personal', 'gmail', 'c1', at);
    await repo.set('personal', 'calendar:primary', 'x', at);
    await repo.set('personal', 'gmail', 'c2', at.plus({ minutes: 5 }));
    expect(await repo.get('personal', 'gmail')).toBe('c2');
    expect(await repo.get('personal', 'calendar:primary')).toBe('x');
    expect((await repo.lastRunAt('personal', 'gmail'))!.toMillis()).toBe(at.plus({ minutes: 5 }).toMillis());
  });
});
