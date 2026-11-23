import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

export function createDb(url: string): Db {
  return drizzle({ client: new Pool({ connectionString: url }), schema });
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
