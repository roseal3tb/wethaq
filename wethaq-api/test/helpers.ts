import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../src/db.js';
import { migrate } from '../src/db.js';

/** An in-process PostgreSQL (PGlite) with the Wethaq schema, so tests need no database server. */
export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const wrap = (q: { query: PGlite['query'] }) => ({ query: (text: string, params?: unknown[]) => q.query(text, params as any[]) as Promise<{ rows: any[] }> });
  const db: Db = {
    ...wrap(pg),
    transaction: fn => pg.transaction(tx => fn(wrap(tx))),
    close: () => pg.close()
  };
  await migrate(db);
  return db;
}
