import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import { seed } from '../src/seed.js';
import { testDb } from './helpers.js';

let db: Db; let app: ReturnType<typeof createApp>;
let admin = ''; let dispatcher = '';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });

beforeAll(async () => {
  db = await testDb();
  const ledger = localLedger(db);
  await seed(db, ledger, { password: 'test-pass' });
  app = createApp({ db, ledger, config: { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: true, tempPasswordHours: 24 } });
  admin = (await login('admin@wethaq.demo', 'test-pass')).body.token;
  dispatcher = (await login('dispatcher@wethaq.demo', 'test-pass')).body.token;
});
afterAll(async () => { await db?.close(); });

describe('temporary passwords and password changes', () => {
  let email = ''; let temporary = ''; let token = ''; let id = '';

  it('creates a user whose temporary password expires in 24 hours', async () => {
    const res = await request(app).post('/api/users').set(bearer(admin)).send({ name: 'Temp Example', email: 'temp@wethaq.demo', role: 'Receiver', org: 'Org2 (Receiving)' });
    expect(res.status).toBe(201);
    ({ email, temporaryPassword: temporary, id } = res.body);
    expect(res.body.mustChangePassword).toBe(true);
    const hours = (new Date(res.body.passwordExpiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9); expect(hours).toBeLessThanOrEqual(24);
  });

  it('signs in with the temporary password but allows nothing until it is changed', async () => {
    const res = await login(email, temporary);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    token = res.body.token;
    expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(200);
    const blocked = await request(app).get('/api/state').set(bearer(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('enforces the password policy and checks the current password', async () => {
    const change = (body: object) => request(app).post('/api/auth/password').set(bearer(token)).send(body);
    expect((await change({ currentPassword: temporary, newPassword: 'short1' })).body.error).toMatch(/8 to 128/);
    expect((await change({ currentPassword: temporary, newPassword: 'onlyletters' })).body.error).toMatch(/letter and one digit/);
    expect((await change({ currentPassword: 'wrong', newPassword: 'NewPass123' })).body.error).toBe('The current password is incorrect');
  });

  it('replaces the temporary password, then the old one stops working', async () => {
    const res = await request(app).post('/api/auth/password').set(bearer(token)).send({ currentPassword: temporary, newPassword: 'NewPass123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ mustChangePassword: false, passwordExpiresAt: null });
    expect((await request(app).get('/api/state').set(bearer(res.body.token))).status).toBe(200);
    expect((await login(email, temporary)).status).toBe(401);
    expect((await login(email, 'NewPass123')).status).toBe(200);
  });

  it('refuses an expired temporary password, at sign-in and for open sessions', async () => {
    const reset = await request(app).post(`/api/users/${id}/reset-password`).set(bearer(admin));
    expect(reset.status).toBe(200);
    const session = (await login(email, reset.body.temporaryPassword)).body.token;
    await db.query("UPDATE users SET password_expires_at = now() - interval '1 minute' WHERE user_id = $1", [id]);
    const res = await login(email, reset.body.temporaryPassword);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/temporary password has expired/);
    expect((await request(app).get('/api/auth/me').set(bearer(session))).status).toBe(401);
  });

  it('lets only an administrator reset passwords, and not their own', async () => {
    expect((await request(app).post(`/api/users/${id}/reset-password`).set(bearer(dispatcher))).status).toBe(403);
    const me = (await request(app).get('/api/auth/me').set(bearer(admin))).body.user.id;
    expect((await request(app).post(`/api/users/${me}/reset-password`).set(bearer(admin))).status).toBe(400);
  });
});

describe('live event stream', () => {
  let server: Server; let base = '';
  beforeAll(async () => { server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`; });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('requires a signed-in user', async () => {
    expect((await fetch(`${base}/events`)).status).toBe(401);
  });

  it('streams ledger commits and database changes to open dashboards', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/events`, { headers: bearer(dispatcher), signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader(); const decoder = new TextDecoder();
    let text = '';
    const until = async (pattern: RegExp) => { while (!pattern.test(text)) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value); } };
    await until(/event: ready/);
    const state = (await request(app).get('/api/state').set(bearer(admin))).body;
    const target = state.shipments.find((s: any) => s.status === 'Requested');
    const op = await request(app).post(`/api/shipments/${target.id}/dispatch`).set(bearer(dispatcher)).send({ qty: target.quantity, note: 'event test' });
    expect(op.body.passed).toBe(true);
    await until(/"kind":"app"/);
    controller.abort();
    const events = [...text.matchAll(/event: change\ndata: (.+)\n/g)].map(m => JSON.parse(m[1]));
    expect(events.find(e => e.kind === 'ledger')).toMatchObject({ name: 'ShipmentUpdated', shipmentId: target.id, txId: op.body.txId, block: op.body.block, status: 'Dispatched', operation: 'dispatch' });
    expect(events.find(e => e.kind === 'app')).toMatchObject({ name: 'ShipmentUpdated', shipmentId: target.id });
  });
});
