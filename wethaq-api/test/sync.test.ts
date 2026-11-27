/**
 * Synchronization between the ledger and PostgreSQL: Case A/B/C, unknown outcomes, reconciliation,
 * idempotency, duplicate events and inventory applied exactly once. Failures are injected around the
 * local development ledger; nothing here claims to exercise Hyperledger Fabric itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import { LedgerError, type Ledger, type PreparedTransaction } from '../src/ledger/types.js';
import { seed } from '../src/seed.js';
import { applyRecord, reconcile } from '../src/services/operations.js';
import { testDb } from './helpers.js';

type Fault = 'none' | 'committed-timeout' | 'lost-submit' | 'unavailable' | 'endorsement';

/** The local ledger with a switchable fault on submission. */
function faulty(inner: Ledger) {
  const control = { fault: 'none' as Fault, reachable: true };
  const wrap = (p: PreparedTransaction): PreparedTransaction => ({
    txId: p.txId,
    async submit() {
      switch (control.fault) {
        case 'committed-timeout': await p.submit(); throw new LedgerError('commit_timeout', 'Commit status not received in time', p.txId);
        case 'lost-submit': throw new LedgerError('submit', 'Connection to the orderer lost', p.txId);
        case 'unavailable': throw new LedgerError('unavailable', 'No connection to the gateway', p.txId);
        case 'endorsement': throw new LedgerError('endorsement', 'Peers did not endorse', p.txId);
        default: return p.submit();
      }
    }
  });
  const ledger: Ledger = {
    ...inner,
    prepareRegister: async i => wrap(await inner.prepareRegister(i)),
    prepareSubmit: async i => wrap(await inner.prepareSubmit(i)),
    async transactionStatus(txId) { if (!control.reachable) throw new LedgerError('unavailable', 'unreachable'); return inner.transactionStatus(txId); },
    async verify(id, expected) { if (!control.reachable) throw new LedgerError('unavailable', 'unreachable'); return inner.verify(id, expected); }
  };
  return { ledger, control };
}

let db: Db; let app: ReturnType<typeof createApp>; let control: ReturnType<typeof faulty>['control']; let base: Ledger;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
const onHand = async (partId: string, location: string) => (await db.query<{ on_hand: number }>('SELECT on_hand FROM inventory WHERE part_id = $1 AND location_id = $2', [partId, location])).rows[0].on_hand;
const newRequest = async (extra: Record<string, string> = {}) => request(app).post('/api/shipments').set({ ...as('Planner'), ...extra }).send({ partId: 'SP-010', location: 'Distribution Center', qty: 6, month: '2026-12', note: 'Sync test' });
const settle = () => new Promise(r => setTimeout(r, 30));

beforeAll(async () => {
  db = await testDb();
  base = localLedger(db);
  const f = faulty(base);
  control = f.control;
  await seed(db, f.ledger, { password: 'test-pass' });
  app = createApp({ db, ledger: f.ledger, config: { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: true, pendingExpiryMs: 60_000 } });
  for (const role of ['planner', 'dispatcher', 'receiver', 'admin']) {
    const res = await request(app).post('/api/auth/login').send({ email: `${role}@wethaq.demo`, password: 'test-pass' });
    tokens[role[0].toUpperCase() + role.slice(1)] = res.body.token;
  }
});
beforeEach(() => { control.fault = 'none'; control.reachable = true; });
afterAll(async () => { app?.stopLedgerEvents(); await db?.close(); });

describe('Case C: definite failures', () => {
  it('returns 503 and keeps nothing when the network is unavailable', async () => {
    const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM shipments')).rows[0].n;
    control.fault = 'unavailable';
    const res = await newRequest();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ledgerFailure: 'unavailable', ledgerState: 'failed' });
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM shipments')).rows[0].n).toBe(before);
    const op = (await db.query<any>('SELECT * FROM ledger_operations WHERE operation_id = $1', [res.body.txId])).rows[0];
    expect(op).toMatchObject({ state: 'failed', failure: 'unavailable' });
    expect((await db.query<any>(`SELECT * FROM audit_log WHERE action = 'ledger.request' AND outcome = 'failed'`)).rows.length).toBeGreaterThan(0);
  });
  it('returns 502 for an endorsement failure, with no state change', async () => {
    const id = (await db.query<any>(`SELECT shipment_id FROM shipments WHERE status = 'Requested' AND ledger_state = 'confirmed' ORDER BY shipment_id LIMIT 1`)).rows[0].shipment_id;
    control.fault = 'endorsement';
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 1 });
    expect(res.status).toBe(502);
    expect((await db.query<any>('SELECT status FROM shipments WHERE shipment_id = $1', [id])).rows[0].status).toBe('Requested');
  });
});

describe('Case C: unknown outcomes and reconciliation', () => {
  it('answers 202 for a timeout, then applies the committed result exactly once', async () => {
    const created = await newRequest();
    expect(created.status).toBe(201);
    const id = created.body.id;
    const stockBefore = await onHand('SP-010', 'LOC-CW');
    control.fault = 'committed-timeout';
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 6 });
    expect(res.status === 202 || res.status === 200).toBe(true);
    await settle();
    control.fault = 'none';
    // The transaction did commit: the event consumer or the reconciler applies it, and only once.
    await reconcile(db, base, { pendingExpiryMs: 60_000 });
    await reconcile(db, base, { pendingExpiryMs: 60_000 });
    const s = (await db.query<any>('SELECT * FROM shipments WHERE shipment_id = $1', [id])).rows[0];
    expect(s).toMatchObject({ status: 'Dispatched', dispatched_qty: 6, ledger_state: 'confirmed' });
    expect(await onHand('SP-010', 'LOC-CW')).toBe(Math.max(0, stockBefore - 6));
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM ledger_records WHERE shipment_id = $1 AND type = 'DISPATCH'`, [id])).rows[0].n).toBe(1);
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id = $1 AND status = 'Dispatched'`, [id])).rows[0].n).toBe(1);
    const op = (await db.query<any>('SELECT * FROM ledger_operations WHERE operation_id = $1', [res.body.txId])).rows[0];
    expect(op.state).toBe('committed');
    expect(op.applied_at).not.toBeNull();
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM alerts WHERE dedupe_key = $1 AND NOT acknowledged`, [`pending:${res.body.txId}`])).rows[0].n).toBe(0);
  });

  it('keeps a request pending when the submission is lost, then marks it failed after the expiry', async () => {
    control.fault = 'lost-submit';
    const res = await newRequest();
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pending: true, ledgerState: 'pending' });
    const id = res.body.id;
    expect((await db.query<any>('SELECT ledger_state FROM shipments WHERE shipment_id = $1', [id])).rows[0].ledger_state).toBe('pending');
    expect((await request(app).get(`/api/shipments/${id}/verify`).set(as('Admin'))).body.status).toBe('pending');
    expect((await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 1 })).status).toBe(409);
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM alerts WHERE type = 'Pending transaction' AND dedupe_key = $1`, [`pending:${res.body.txId}`])).rows[0].n).toBe(1);
    control.fault = 'none';
    // Not on the ledger, but not expired yet: still pending.
    expect((await reconcile(db, base, { pendingExpiryMs: 60_000 })).stillPending).toBeGreaterThan(0);
    // After the expiry: failed, with a sync alert and no ledger record.
    const report = await reconcile(db, base, { pendingExpiryMs: 0 });
    expect(report.failed).toBeGreaterThan(0);
    expect((await db.query<any>('SELECT ledger_state FROM shipments WHERE shipment_id = $1', [id])).rows[0].ledger_state).toBe('failed');
    expect((await request(app).get(`/api/shipments/${id}/verify`).set(as('Admin'))).body.status).toBe('failed');
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM alerts WHERE type = 'Ledger sync' AND dedupe_key = $1`, [`failed:${res.body.txId}`])).rows[0].n).toBe(1);
  });

  it('recovers a transaction committed before a crash, before PostgreSQL was updated', async () => {
    const id = (await newRequest()).body.id;
    const user = (await db.query<any>(`SELECT user_id, name FROM users WHERE email = 'dispatcher@wethaq.demo'`)).rows[0];
    const prepared = await base.prepareSubmit({ operation: 'dispatch', shipmentId: id, qty: 4, org: 'Org1MSP' });
    await db.query(`INSERT INTO ledger_operations (operation_id, kind, shipment_id, user_id, user_name, org, quantity, state, created_at) VALUES ($1, 'dispatch', $2, $3, $4, 'Org1MSP', 4, 'submitting', now() - interval '10 minutes')`, [prepared.txId, id, user.user_id, user.name]);
    app.stopLedgerEvents(); // the "crashed" process applies nothing
    await prepared.submit();
    expect((await db.query<any>('SELECT status FROM shipments WHERE shipment_id = $1', [id])).rows[0].status).toBe('Requested');
    const report = await reconcile(db, base, { pendingExpiryMs: 60_000 });
    expect(report.applied).toBeGreaterThan(0);
    expect((await db.query<any>('SELECT status, dispatched_qty FROM shipments WHERE shipment_id = $1', [id])).rows[0]).toMatchObject({ status: 'Dispatched', dispatched_qty: 4 });
  });

  it('does not decide anything while the ledger is unreachable, and raises one sync alert', async () => {
    control.fault = 'lost-submit';
    const res = await newRequest();
    control.fault = 'none'; control.reachable = false;
    await reconcile(db, base as Ledger, { pendingExpiryMs: 60_000 }); // base is reachable; use the faulty one below
    const f = { ...base, transactionStatus: async () => { throw new LedgerError('unavailable', 'unreachable'); } } as Ledger;
    await reconcile(db, f, { pendingExpiryMs: 0 });
    await reconcile(db, f, { pendingExpiryMs: 0 });
    expect((await db.query<any>('SELECT state FROM ledger_operations WHERE operation_id = $1', [res.body.txId])).rows[0].state).toBe('unknown');
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM alerts WHERE dedupe_key = 'ledger-sync:unreachable' AND NOT acknowledged`)).rows[0].n).toBe(1);
    const verify = await request(app).get(`/api/shipments/${(await db.query<any>(`SELECT shipment_id FROM shipments WHERE ledger_state = 'confirmed' LIMIT 1`)).rows[0].shipment_id}/verify`).set(as('Admin'));
    expect(verify.body.status).toBe('ledger_unavailable');
    control.reachable = true;
    await reconcile(db, base, { pendingExpiryMs: 0 });
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM alerts WHERE dedupe_key = 'ledger-sync:unreachable' AND NOT acknowledged`)).rows[0].n).toBe(0);
  });
});

describe('idempotency and duplicate events', () => {
  it('replays the stored response for a repeated Idempotency-Key and creates one shipment', async () => {
    const key = { 'Idempotency-Key': 'test-key-0001' };
    const a = await newRequest(key);
    const b = await newRequest(key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM ledger_operations WHERE idempotency_key = 'test-key-0001'`)).rows[0].n).toBe(1);
    expect((await newRequest({ 'Idempotency-Key': 'bad key!' })).status).toBe(400);
  });
  it('applies a duplicated ledger event once: one record, one timeline entry, one stock change', async () => {
    const id = (await newRequest()).body.id;
    const before = await onHand('SP-010', 'LOC-CW');
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 2 });
    expect(res.status).toBe(200);
    const record = await base.readRecord(res.body.txId);
    for (let i = 0; i < 3; i++) await applyRecord(db, record!, res.body.block);
    expect(await onHand('SP-010', 'LOC-CW')).toBe(Math.max(0, before - 2));
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id = $1 AND status = 'Dispatched'`, [id])).rows[0].n).toBe(1);
  });
  it('raises one open shortage alert per position, not one per movement', async () => {
    const keys = (await db.query<any>(`SELECT dedupe_key, count(*)::int AS n FROM alerts WHERE dedupe_key LIKE 'shortage:%' AND NOT acknowledged GROUP BY dedupe_key`)).rows;
    expect(keys.every((k: any) => k.n === 1)).toBe(true);
  });
});

describe('administration, health and analytics', () => {
  it('shows the sync status to administrators only', async () => {
    expect((await request(app).get('/api/admin/sync-status').set(as('Planner'))).status).toBe(403);
    const res = await request(app).get('/api/admin/sync-status').set(as('Admin'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ledger: 'local' });
    expect(res.body.operations.committed).toBeGreaterThan(0);
    expect((await request(app).post('/api/admin/reconcile').set(as('Admin'))).status).toBe(200);
    expect((await request(app).get('/api/admin/audit').set(as('Admin'))).body.some((r: any) => r.action === 'auth.login')).toBe(true);
  });
  it('reports liveness and readiness', async () => {
    expect((await request(app).get('/api/health/live')).body).toEqual({ ok: true });
    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.ledgerHealth.detail).toContain('not Hyperledger Fabric');
  });
  it('returns a request id on every response', async () => {
    expect((await request(app).get('/api/health/live')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('returns live inventory positions with stock in transit', async () => {
    const rows = (await request(app).get('/api/inventory').set(as('Planner'))).body;
    expect(rows).toHaveLength(180);
    expect(rows[0]).toHaveProperty('inTransit');
    expect(rows[0]).toHaveProperty('status');
    expect(rows.some((r: any) => r.inTransit > 0)).toBe(true);
  });
  it('serves the analysis results with their provenance, unchanged', async () => {
    const list = (await request(app).get('/api/analytics').set(as('Planner'))).body;
    expect(list.map((a: any) => a.name)).toEqual(['assessment', 'forecasts', 'raf-parts', 'rolling', 'inventory-simulation']);
    const res = await request(app).get('/api/analytics/forecasts').set(as('Planner'));
    expect(res.status).toBe(200);
    expect(res.body.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(res.body.data)).toEqual(['RAF', 'SYN']);
    expect((await request(app).get('/api/analytics/nope').set(as('Planner'))).status).toBe(404);
    expect((await request(app).get('/api/analytics/forecasts')).status).toBe(401);
  });
});

describe('production configuration', () => {
  const prod = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) };
  it('turns demonstration features off and requires a strong secret', () => {
    const c = loadConfig({ ...prod, DEMO_ROLE_SWITCH: 'true', DEMO_TOOLS: 'true' });
    expect(c).toMatchObject({ production: true, demoRoleSwitch: false, demoTools: false });
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...prod, DEMO_PASSWORD: 'x' })).toThrow(/DEMO_PASSWORD/);
    expect(() => loadConfig({ ...prod, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
  });
  it('refuses demonstration endpoints when they are disabled', async () => {
    const off = createApp({ db, ledger: base, config: { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: false, demoTools: false } });
    expect((await request(off).post('/api/demo/invalid').set(as('Admin')).send({ scenario: 'Duplicate receipt' })).status).toBe(403);
    expect((await request(off).post('/api/auth/switch').set(as('Admin')).send({ role: 'Planner' })).status).toBe(403);
    off.stopLedgerEvents();
  });
});

describe('OpenAPI document', () => {
  it('is served and lists every route of the API', async () => {
    const doc = (await request(app).get('/api/openapi.json')).body;
    expect(doc.openapi).toMatch(/^3\./);
    const documented = new Set(Object.entries(doc.paths).flatMap(([p, ops]: [string, any]) => Object.keys(ops).map(m => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`)));
    const routes: string[] = [];
    const walk = (stack: any[], prefix: string) => {
      for (const layer of stack) {
        if (layer.route) for (const m of Object.keys(layer.route.methods)) routes.push(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
        else if (layer.name === 'router' && layer.handle?.stack) {
          const mount = layer.regexp?.source === '^\\/analytics\\/?(?=\\/|$)' ? '/analytics' : '';
          walk(layer.handle.stack, prefix + mount);
        }
      }
    };
    walk((app as any)._router.stack, '');
    expect(routes.length).toBeGreaterThan(25);
    const missing = routes.map(r => r.replace(/\/$/, '')).filter(r => !documented.has(r));
    expect(missing).toEqual([]);
  });
});
