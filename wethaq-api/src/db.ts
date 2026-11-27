import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

/** Minimal query interface shared by node-postgres (runtime) and PGlite (tests). */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Return BIGINT and NUMERIC as numbers (values in this schema stay well within the safe range).
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1700, v => Number(v));

export function postgres(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    query: (text, params) => pool.query(text, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params as unknown[]) as never });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Applies every migration in migrations/ that has not been applied yet, in file-name order. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = (await readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS, file), 'utf8');
    await db.transaction(async q => {
      for (const statement of splitSql(sql)) await q.query(statement);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Splits a migration file into statements. Migrations must not use '--' or ';' inside string literals or function bodies. */
function splitSql(sql: string): string[] {
  return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n').split(';').map(s => s.trim()).filter(Boolean);
}
