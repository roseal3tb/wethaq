import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { logger } from './logger.js';

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
  // An idle connection that PostgreSQL closes (restart, failover, administrator) is reported here. Without a
  // listener Node would stop the whole API; the pool opens a new connection for the next query instead.
  pool.on('error', err => logger.warn('database_connection_lost', { error: String(err) }));
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

/**
 * True when an error means PostgreSQL could not be reached or dropped the connection (not a query error).
 * Such requests are answered 503 so that clients retry, instead of a generic 500.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '53300'].includes(code) || code.startsWith('08')) return true;
  const message = typeof e.message === 'string' ? e.message : '';
  if (/Connection terminated|connection timeout|Client has encountered a connection error|Cannot use a pool after calling end/i.test(message)) return true;
  return e.cause ? isDatabaseUnavailable(e.cause) : false;
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

/**
 * Splits a migration file into statements on ';'. A dollar-quoted body ($$ ... $$, for a PL/pgSQL function) is
 * kept whole. Migrations must not use '--' inside string literals or bodies, or ';' inside string literals.
 */
export function splitSql(sql: string): string[] {
  const text = sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
  const statements: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$$', i)) { quoted = !quoted; current += '$$'; i++; continue; }
    if (text[i] === ';' && !quoted) { statements.push(current); current = ''; continue; }
    current += text[i];
  }
  statements.push(current);
  return statements.map(s => s.trim()).filter(Boolean);
}
