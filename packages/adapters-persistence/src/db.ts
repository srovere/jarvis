import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

export function createDb(url: string): Db {
  const pool = new Pool({ connectionString: url });
  // Idle clients can emit errors (e.g. connection reset); without a listener they would crash the process.
  pool.on('error', (err) => {
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'postgres pool error', error: err.message })}\n`);
  });
  return drizzle({ client: pool, schema });
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
