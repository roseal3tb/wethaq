/** Sessions: sign-out on the server, sessions ended by a password change or reset, expired and forged tokens. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import { seed } from '../src/seed.js';
import { testDb } from './helpers.js';

const SECRET = 'test-secret-for-session-tests';
let db: Db; let app: ReturnType<typeof createApp>;
const login = async (email: string, password = 'test-pass') => (await request(app).post('/api/auth/login').send({ email, password })).body.token as string;
const me = (token: string) => request(app).get('/api/auth/me').set({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await testDb();
  const ledger = localLedger(db);
  await seed(db, ledger, { password: 'test-pass' });
  app = createApp({ db, ledger, config: { jwtSecret: SECRET, jwtTtl: '1h', demoRoleSwitch: true } });
});
afterAll(async () => { app?.stopLedgerEvents(); await db?.close(); });

describe('sign-out', () => {
  it('refuses the token after sign-out, and records it in the audit log', async () => {
    const token = await login('planner@wethaq.demo');
    expect((await me(token)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set({ Authorization: `Bearer ${token}` })).status).toBe(200);
    const after = await me(token);
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/signed out/);
    expect((await request(app).get('/api/state').set({ Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'auth.logout'`)).rows[0].n).toBe(1);
  });
  it('keeps the same account signed in on another device', async () => {
    const first = await login('dispatcher@wethaq.demo');
    const second = await login('dispatcher@wethaq.demo');
    await request(app).post('/api/auth/logout').set({ Authorization: `Bearer ${first}` });
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
  });
  it('needs a valid session to sign out', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });
});

describe('password change and reset', () => {
  it('ends the other sessions when a user changes their password, and the new token works', async () => {
    const other = await login('receiver@wethaq.demo');
    const current = await login('receiver@wethaq.demo');
    const res = await request(app).post('/api/auth/password').set({ Authorization: `Bearer ${current}` }).send({ currentPassword: 'test-pass', newPassword: 'NewPassw0rd' });
    expect(res.status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await me(current)).status).toBe(401);
    expect((await me(res.body.token)).status).toBe(200);
  });
  it("ends a user's sessions when an administrator resets their password", async () => {
    const admin = await login('admin@wethaq.demo');
    const target = (await db.query<{ user_id: string; email: string }>(`SELECT user_id, email FROM users WHERE email <> 'admin@wethaq.demo' AND email <> 'receiver@wethaq.demo' AND active ORDER BY user_id LIMIT 1`)).rows[0];
    const token = await login(target.email);
    expect((await me(token)).status).toBe(200);
    expect((await request(app).post(`/api/users/${target.user_id}/reset-password`).set({ Authorization: `Bearer ${admin}` })).status).toBe(200);
    expect((await me(token)).status).toBe(401);
  });
});

describe('expired and forged tokens', () => {
  it('refuses an expired token', async () => {
    const user = (await db.query<{ user_id: string }>(`SELECT user_id FROM users WHERE email = 'admin@wethaq.demo'`)).rows[0];
    const expired = jwt.sign({ sub: user.user_id, role: 'Admin', sv: 0, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, { algorithm: 'HS256' });
    const res = await me(expired);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/);
  });
  it('refuses a token signed with another key, and an unsigned token', async () => {
    const user = (await db.query<{ user_id: string }>(`SELECT user_id FROM users WHERE email = 'admin@wethaq.demo'`)).rows[0];
    expect((await me(jwt.sign({ sub: user.user_id, role: 'Admin', sv: 0 }, 'another-key', { algorithm: 'HS256' }))).status).toBe(401);
    expect((await me(jwt.sign({ sub: user.user_id, role: 'Admin', sv: 0 }, '', { algorithm: 'none' } as jwt.SignOptions))).status).toBe(401);
  });
  it('takes the role from the database, not from the token', async () => {
    const dispatcher = (await db.query<{ user_id: string; session_version: number }>(`SELECT user_id, session_version FROM users WHERE email = 'dispatcher@wethaq.demo'`)).rows[0];
    const forged = jwt.sign({ sub: dispatcher.user_id, role: 'Admin', sv: dispatcher.session_version }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    expect((await me(forged)).body.user.role).toBe('Dispatcher');
    expect((await request(app).get('/api/admin/audit').set({ Authorization: `Bearer ${forged}` })).status).toBe(403);
  });
});
