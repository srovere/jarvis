import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { closeDb, createDb, type Db } from './db';
import { runMigrations } from './migrate';

/** Starts one `postgres:17` container per test file, migrates it, and truncates all data between tests. */
export function useTestDb(): { db: () => Db } {
  let container: StartedPostgreSqlContainer;
  let db: Db;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17').start();
    db = createDb(container.getConnectionUri());
    await runMigrations(db);
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE accounts CASCADE`);
  });

  afterAll(async () => {
    if (db) await closeDb(db);
    await container?.stop();
  });

  return { db: () => db };
}
