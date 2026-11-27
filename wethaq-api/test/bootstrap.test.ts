/** First start of a real installation: reference data and one administrator, no demonstration data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import { AlreadyInitialised, bootstrap } from '../src/services/bootstrap.js';
import { testDb } from './helpers.js';

let db: Db;
const count = async (table: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db?.close(); });

describe('bootstrap', () => {
  let admin: Awaited<ReturnType<typeof bootstrap>>;
  it('creates the reference data and one administrator, and no demonstration data', async () => {
    admin = await bootstrap(db, { name: 'First Admin', email: 'Admin@Example.org' });
    expect(admin).toMatchObject({ email: 'admin@example.org', role: 'Admin', org: 'System Administration', mustChangePassword: true });
    expect(admin.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(await count('users')).toBe(1);
    expect(await count('organizations')).toBe(4);
    expect(await count('roles')).toBe(4);
    expect(await count('locations')).toBeGreaterThan(0);
    for (const table of ['parts', 'inventory', 'shipments', 'ledger_records', 'alerts']) expect(await count(table)).toBe(0);
    const stored = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users')).rows[0].password_hash;
    expect(stored).not.toContain(admin.temporaryPassword);
    expect(await count(`audit_log WHERE action = 'system.bootstrap'`)).toBe(1);
  });
  it('refuses a database that is already in use', async () => {
    await expect(bootstrap(db, { name: 'Second', email: 'second@example.org' })).rejects.toBeInstanceOf(AlreadyInitialised);
    expect(await count('users')).toBe(1);
  });
  it('lets the administrator sign in only to replace the temporary password', async () => {
    const app = createApp({ db, ledger: localLedger(db), config: { jwtSecret: 'bootstrap-test-secret', jwtTtl: '1h', demoRoleSwitch: false } });
    try {
      const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: admin.temporaryPassword });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      const auth = { Authorization: `Bearer ${login.body.token}` };
      expect((await request(app).get('/api/state').set(auth)).status).toBe(403);
      const changed = await request(app).post('/api/auth/password').set(auth).send({ currentPassword: admin.temporaryPassword, newPassword: 'A-long-new-passphrase-42' });
      expect(changed.status).toBe(200);
      const again = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'A-long-new-passphrase-42' });
      expect(again.status).toBe(200);
      expect((await request(app).get('/api/admin/audit').set({ Authorization: `Bearer ${again.body.token}` })).status).toBe(200);
    } finally { app.stopLedgerEvents(); }
  });
  it('can load the demonstration catalogue on request', async () => {
    const other = await testDb();
    try {
      await bootstrap(other, { name: 'Trial Admin', email: 'trial@example.org', catalogue: true });
      expect((await other.query<{ n: number }>('SELECT count(*)::int AS n FROM parts')).rows[0].n).toBe(60);
      expect((await other.query<{ n: number }>('SELECT count(*)::int AS n FROM shipments')).rows[0].n).toBe(0);
    } finally { await other.close(); }
  });
});
