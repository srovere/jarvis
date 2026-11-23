import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './db';

/** The generated `drizzle/` folder lives at the package root, so this works from `src` and from `dist`. */
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../drizzle');

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
