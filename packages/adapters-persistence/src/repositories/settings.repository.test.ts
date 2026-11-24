import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test-db.test-support';
import { settings } from '../schema';
import { DrizzleSettingsRepository } from './settings.repository';

const t = useTestDb();

describe('DrizzleSettingsRepository malformed rows', () => {
  it.each([
    ['missing sync.intervalMinutes', { zone: 'UTC', workSchedule: { startHour: 9, endHour: 19, workDays: [1] }, focus: { titlePrefix: 'x', horizonWorkDays: 5, defaultDurationMinutes: 90 }, sync: { gmailInitialWindowDays: 90 }, briefing: { maxPriorityEmails: 10 } }],
    ['missing workSchedule', { zone: 'UTC' }],
    ['not an object', 'garbage'],
  ])('treats a row with %s as absent and warns without dumping data', async (_name, data) => {
    const logs: string[] = [];
    await t.db().insert(settings).values({ id: 1, data });
    const repo = new DrizzleSettingsRepository(t.db(), (l) => logs.push(l));
    expect(await repo.load()).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('malformed settings row');
    expect(logs[0]).not.toContain('garbage');
  });

  const valid = {
    zone: 'UTC',
    workSchedule: { startHour: 9, endHour: 19, workDays: [1] },
    focus: { titlePrefix: 'x', horizonWorkDays: 5, defaultDurationMinutes: 90 },
    sync: { intervalMinutes: 5, gmailInitialWindowDays: 90 },
    briefing: { maxPriorityEmails: 10 },
  };

  it('accepts a row without agent and with a valid agent', async () => {
    await t.db().insert(settings).values({ id: 1, data: valid });
    expect(await new DrizzleSettingsRepository(t.db(), () => undefined).load()).toEqual(valid);
    const agent = { provider: 'claude', status: 'connected', verifiedAt: '2026-11-24T10:00:00.000Z', latencyMs: 9 };
    await new DrizzleSettingsRepository(t.db()).save({ ...valid, agent } as never);
    expect(await new DrizzleSettingsRepository(t.db()).load()).toEqual({ ...valid, agent });
  });

  it('drops a malformed agent but keeps the preferences', async () => {
    await t.db().insert(settings).values({ id: 1, data: { ...valid, agent: { status: 'bogus' } } });
    expect(await new DrizzleSettingsRepository(t.db(), () => undefined).load()).toEqual(valid);
  });
});
