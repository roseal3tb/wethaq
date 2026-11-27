import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import { seed } from '../src/seed.js';
import { testDb } from './helpers.js';

let db: Db; let app: Express;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
const state = async (role = 'Admin') => (await request(app).get('/api/state').set(as(role))).body;
const shipmentIn = async (status: string) => (await state()).shipments.find((s: any) => s.status === status);

beforeAll(async () => {
  db = await testDb();
  const ledger = localLedger(db);
  await seed(db, ledger, { password: 'test-pass' });
  app = createApp({ db, ledger, config: { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: true } });
  for (const role of ['planner', 'dispatcher', 'receiver', 'admin']) {
    const res = await request(app).post('/api/auth/login').send({ email: `${role}@wethaq.demo`, password: 'test-pass' });
    expect(res.status).toBe(200);
    tokens[role[0].toUpperCase() + role.slice(1)] = res.body.token;
  }
});
afterAll(async () => { await db?.close(); });

describe('authentication', () => {
  it('rejects a wrong password without saying which part was wrong', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'planner@wethaq.demo', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect email or password');
  });
  it('requires a token', async () => {
    expect((await request(app).get('/api/state')).status).toBe(401);
    expect((await request(app).get('/api/state').set({ Authorization: 'Bearer forged' })).status).toBe(401);
  });
  it('returns the signed-in user without the password hash', async () => {
    const res = await request(app).get('/api/auth/me').set(as('Planner'));
    expect(res.body.user).toMatchObject({ email: 'planner@wethaq.demo', role: 'Planner', org: 'Logistics Command' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
  it('switches to the demonstration account of another role', async () => {
    const res = await request(app).post('/api/auth/switch').set(as('Planner')).send({ role: 'Receiver' });
    expect(res.body.user).toMatchObject({ role: 'Receiver', org: 'Org2 (Receiving)' });
  });
});

describe('state', () => {
  it('returns the seeded demonstration data in the dashboard format', async () => {
    const s = await state();
    expect(s.shipments).toHaveLength(48);
    expect(s.users).toHaveLength(8);
    expect(s.transactions.filter((t: any) => t.status === 'Rejected')).toHaveLength(5);
    expect(s.transactions.every((t: any) => t.status === 'Rejected' || (t.block > 0 && t.hash.length === 64))).toBe(true);
    expect(s.alerts.some((a: any) => a.type === 'Discrepancy')).toBe(true);
  });
  it('shows other users only to administrators', async () => {
    expect((await state('Planner')).users).toHaveLength(1);
  });
});

describe('shipment workflow', () => {
  let id: string;
  it('lets only a planner create a request, and registers it on the ledger', async () => {
    const body = { partId: 'SP-004', location: 'Deployment Site', qty: 10, month: '2026-12', note: 'Planner reviewed' };
    expect((await request(app).post('/api/shipments').set(as('Dispatcher')).send(body)).status).toBe(403);
    expect((await request(app).post('/api/shipments').set(as('Planner')).send({ ...body, qty: 0 })).status).toBe(400);
    const res = await request(app).post('/api/shipments').set(as('Planner')).send(body);
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(id).toMatch(/^SHP-\d{4}-0049$/);
    expect((await request(app).get(`/api/shipments/${id}/verify`).set(as('Planner'))).body).toMatchObject({ onLedger: true, match: true });
  });
  it('rejects a dispatch by the wrong role in the application, off the ledger', async () => {
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Receiver')).send({ qty: 5 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ passed: false, source: 'application', failedRule: 'authorizedOrg' });
    expect(res.body.txId).toBeUndefined();
  });
  it('rejects a dispatch above the requested quantity in the chaincode', async () => {
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 11 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ passed: false, source: 'chaincode', failedRule: 'validQuantity' });
    expect(res.body.block).toBeGreaterThan(0);
  });
  it('commits dispatch, in transit and a short receipt, with a discrepancy alert', async () => {
    const before = (await request(app).get('/api/inventory').set(as('Admin'))).body.find((r: any) => r.partId === 'SP-004' && r.location === 'Central Warehouse').onHand;
    for (const [role, op, qty] of [['Dispatcher', 'dispatch', 10], ['Dispatcher', 'transit', 0], ['Receiver', 'receive', 8]] as const) {
      const res = await request(app).post(`/api/shipments/${id}/${op}`).set(as(role)).send({ qty, note: 'ok' });
      expect(res.status, `${op}: ${res.body.reason}`).toBe(200);
      expect(res.body).toMatchObject({ passed: true, source: 'chaincode' });
    }
    const s = (await state()).shipments.find((x: any) => x.id === id);
    expect(s).toMatchObject({ status: 'Received', dispatchedQty: 10, receivedQty: 8, createdInSession: true });
    expect(s.events.map((e: any) => e.status)).toEqual(['Requested', 'Dispatched', 'In Transit', 'Received']);
    expect((await state()).alerts.some((a: any) => a.type === 'Discrepancy' && a.shipmentId === id)).toBe(true);
    const inv = (await request(app).get('/api/inventory').set(as('Admin'))).body;
    expect(inv.find((r: any) => r.partId === 'SP-004' && r.location === 'Central Warehouse').onHand).toBe(before - 10);
  });
  it('rejects a second receipt as a duplicate', async () => {
    const res = await request(app).post(`/api/shipments/${id}/receive`).set(as('Receiver')).send({ qty: 1 });
    expect(res.body).toMatchObject({ passed: false, failedRule: 'noDuplicate', source: 'chaincode' });
  });
  it('detects a reporting copy that no longer matches the ledger', async () => {
    await db.query('UPDATE shipments SET received_qty = 10 WHERE shipment_id = $1', [id]);
    const res = await request(app).get(`/api/shipments/${id}/verify`).set(as('Admin'));
    expect(res.body.match).toBe(false);
    expect(res.body.differences).toEqual(['Received quantity: database 10, ledger 8']);
    expect(res.body.history.map((r: any) => `${r.operation}:${r.status}`)).toEqual(['request:Committed', 'dispatch:Rejected', 'dispatch:Committed', 'transit:Committed', 'receive:Committed', 'receive:Rejected']);
  });
});

describe('rejected-operation demonstrations', () => {
  const expected: Record<string, string> = {
    'Duplicate receipt': 'noDuplicate', 'Unauthorized organization': 'authorizedOrg', 'Invalid status transition': 'validTransition',
    'Quantity exceeds dispatched': 'validQuantity', 'Unknown shipment reference': 'validReference'
  };
  for (const [scenario, rule] of Object.entries(expected)) {
    it(`${scenario} is rejected by the chaincode (${rule})`, async () => {
      const before = await state();
      const res = await request(app).post('/api/demo/invalid').set(as('Planner')).send({ scenario });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ passed: false, failedRule: rule, source: 'chaincode' });
      const after = await state();
      expect(after.shipments.map((s: any) => s.status)).toEqual(before.shipments.map((s: any) => s.status));
    });
  }
  it('rejects an unknown scenario', async () => {
    expect((await request(app).post('/api/demo/invalid').set(as('Planner')).send({ scenario: 'drop table' })).status).toBe(400);
  });
});

describe('alerts and users', () => {
  it('acknowledges an alert with a note', async () => {
    const alert = (await state()).alerts.find((a: any) => !a.acknowledged);
    expect((await request(app).post(`/api/alerts/${alert.id}/ack`).set(as('Receiver')).send({ note: 'Checked' })).status).toBe(200);
    expect((await state()).alerts.find((a: any) => a.id === alert.id)).toMatchObject({ acknowledged: true, resolutionNote: 'Checked', resolvedBy: 'Receiver S. Otaibi' });
    expect((await request(app).post('/api/alerts/ALT-NOPE/ack').set(as('Receiver'))).status).toBe(404);
  });
  it('lets only an administrator add users, with a one-time password', async () => {
    const body = { name: 'Dispatcher Z. Test', email: 'z.test@wethaq.demo', role: 'Dispatcher', org: 'Org1 (Issuing)' };
    expect((await request(app).post('/api/users').set(as('Planner')).send(body)).status).toBe(403);
    const res = await request(app).post('/api/users').set(as('Admin')).send(body);
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toHaveLength(12);
    const login = await request(app).post('/api/auth/login').send({ email: body.email, password: res.body.temporaryPassword });
    expect(login.body.user.role).toBe('Dispatcher');
    expect((await request(app).post('/api/users').set(as('Admin')).send(body)).status).toBe(409);
  });
  it('moves a user to the organization of a new role, and blocks deactivated users', async () => {
    const res = await request(app).patch('/api/users/USR-005').set(as('Admin')).send({ role: 'Receiver' });
    expect(res.body).toMatchObject({ role: 'Receiver', org: 'Org2 (Receiving)' });
    await request(app).patch('/api/users/USR-005').set(as('Admin')).send({ active: false });
    expect((await request(app).post('/api/auth/login').send({ email: res.body.email, password: 'test-pass' })).status).toBe(401);
  });
  it('stops an administrator from deactivating their own account', async () => {
    expect((await request(app).patch('/api/users/USR-004').set(as('Admin')).send({ active: false })).status).toBe(400);
  });
});
