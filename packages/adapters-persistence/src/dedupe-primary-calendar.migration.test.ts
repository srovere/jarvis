import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from './test-db.test-support';

/** Re-runs migration 0004 on seeded data (the suite's database is already migrated, so 0004 saw no rows). */
const MIGRATION = readFileSync(path.resolve(__dirname, '../drizzle/0004_dedupe_primary_calendar.sql'), 'utf8');

describe('migration 0004: dedupe the primary Google calendar', () => {
  const t = useTestDb();

  async function apply() {
    for (const statement of MIGRATION.split('--> statement-breakpoint')) await t.db().execute(sql.raw(statement));
  }

  async function seedAccount(id: string, email: string, busy: string[], provider = 'google') {
    await t.db().execute(sql`
      INSERT INTO accounts (id, provider, email, status, calendars_busy)
      VALUES (${id}, ${provider}, ${email}, 'active', ${sql.raw(`ARRAY[${busy.map((b) => `'${b}'`).join(',')}]::text[]`)})`);
    for (const cal of [...new Set(['primary', email, 'other@x.com'])]) {
      const [row] = (
        await t.db().execute<{ id: string }>(sql`
          INSERT INTO calendars (account_id, external_id, title) VALUES (${id}, ${cal}, ${cal}) RETURNING id`)
      ).rows;
      await t.db().execute(sql`
        INSERT INTO events (account_id, calendar_id, external_id, title, starts_at, ends_at, all_day, status, attendees, raw)
        VALUES (${id}, ${row!.id}, 'e1', 'Standup', now(), now() + interval '1 hour', false, 'confirmed', '[]'::jsonb, '{}'::jsonb)`);
      await t.db().execute(sql`
        INSERT INTO sync_state (account_id, resource, cursor) VALUES (${id}, ${`calendar:${cal}`}, 'c')`);
    }
  }

  const busy = async (id: string) =>
    (await t.db().execute<{ b: string[] }>(sql`SELECT calendars_busy AS b FROM accounts WHERE id = ${id}`)).rows[0]!.b.sort();
  const calendarsOf = async (id: string) =>
    (await t.db().execute<{ c: string }>(sql`SELECT external_id AS c FROM calendars WHERE account_id = ${id} ORDER BY 1`)).rows.map((r) => r.c);
  const eventsOf = async (id: string) =>
    Number((await t.db().execute<{ n: string }>(sql`SELECT count(*) AS n FROM events WHERE account_id = ${id}`)).rows[0]!.n);
  const cursorsOf = async (id: string) =>
    (await t.db().execute<{ r: string }>(sql`SELECT resource AS r FROM sync_state WHERE account_id = ${id} ORDER BY 1`)).rows.map((r) => r.r);

  it("folds the account email into 'primary' and drops that calendar's events and cursor", async () => {
    await seedAccount('me', 'Me@Gmail.com', ['primary', 'other@x.com', 'me@gmail.com']);
    await apply();
    expect(await busy('me')).toEqual(['other@x.com', 'primary']);
    expect(await calendarsOf('me')).toEqual(['other@x.com', 'primary']);
    expect(await eventsOf('me')).toBe(2);
    expect(await cursorsOf('me')).toEqual(['calendar:other@x.com', 'calendar:primary']);
  });

  it("maps a lone email entry to 'primary'", async () => {
    await seedAccount('me', 'me@gmail.com', ['me@gmail.com']);
    await apply();
    expect(await busy('me')).toEqual(['primary']);
  });

  it('leaves accounts without the duplicate, and other providers, untouched', async () => {
    await seedAccount('clean', 'clean@gmail.com', ['primary']);
    await seedAccount('ms', 'ms@outlook.com', ['primary', 'ms@outlook.com'], 'microsoft');
    await apply();
    expect(await busy('clean')).toEqual(['primary']);
    expect(await busy('ms')).toEqual(['ms@outlook.com', 'primary']);
    expect(await calendarsOf('ms')).toEqual(['ms@outlook.com', 'other@x.com', 'primary']);
  });
});
