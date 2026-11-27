/**
 * Failure scenarios around PostgreSQL and the API process: the database unavailable, the database lost
 * after the ledger committed, an API restart in the middle of an operation, and concurrent operations on
 * the same shipment. The ledger here is the local development ledger (its own PostgreSQL connection);
 * nothing here claims to exercise Hyperledger Fabric itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Db, Queryable } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import type { Ledger, PreparedTransaction } from '../src/ledger/types.js';
import { seed } from '../src/seed.js';
import { reconcile } from '../src/services/operations.js';
import { testDb } from './helpers.js';

/** A database connection that can be "unplugged": every query then fails like a refused connection. */
function switchable(inner: Db) {
  const state = { down: false };
  const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
  const q = (target: Queryable): Queryable => ({ query: (text, params) => (state.down ? Promise.reject(refused()) : target.query(text, params)) as never });
  const db: Db = {
    ...q(inner),
    transaction: fn => (state.down ? Promise.reject(refused()) : inner.transaction(tx => fn(q(tx)))),
    close: () => inner.close()
  };
  return { db, state };
}

/** The local ledger, with a hook that runs right after a transaction is committed (before the API sees the result). */
function hooked(inner: Ledger) {
  const control = { afterCommit: undefined as undefined | (() => void | Promise<void>), submissions: 0 };
  const wrap = (p: PreparedTransaction): PreparedTransaction => ({
    txId: p.txId,
    async submit() {
      control.submissions++;
      const outcome = await p.submit();
      const hook = control.afterCommit; control.afterCommit = undefined;
      await hook?.();
      return outcome;
    }
  });
  const ledger: Ledger = { ...inner, prepareRegister: async i => wrap(await inner.prepareRegister(i)), prepareSubmit: async i => wrap(await inner.prepareSubmit(i)) };
  return { ledger, control };
}

let raw: Db; let db: Db; let net: ReturnType<typeof switchable>['state']; let base: Ledger; let ledger: Ledger; let control: ReturnType<typeof hooked>['control'];
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
const one = async <T = any>(sql: string, params: unknown[] = []) => (await raw.query<T>(sql, params)).rows[0];
const onHand = async (partId: string, location: string) => (await one<{ on_hand: number }>('SELECT on_hand FROM inventory WHERE part_id = $1 AND location_id = $2', [partId, location])).on_hand;
const requested = async () => (await request(app).post('/api/shipments').set(as('Planner')).send({ partId: 'SP-020', location: 'Distribution Center', qty: 5, month: '2026-12', note: 'Failure test' })).body.id as string;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  raw = await testDb();
  const s = switchable(raw); db = s.db; net = s.state;
  base = localLedger(raw); // the ledger keeps its own connection: only the API's PostgreSQL goes away
  const h = hooked(base); ledger = h.ledger; control = h.control;
  await seed(raw, base, { password: 'test-pass' });
  app = createApp({ db, ledger, config: { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: true, pendingExpiryMs: 60_000, resyncDelayMs: 50 } });
  await app.sync.ready;
  for (const role of ['planner', 'dispatcher', 'receiver', 'admin']) {
    const res = await request(app).post('/api/auth/login').send({ email: `${role}@wethaq.demo`, password: 'test-pass' });
    tokens[role[0].toUpperCase() + role.slice(1)] = res.body.token;
  }
});
beforeEach(() => { net.down = false; control.afterCommit = undefined; });
afterAll(async () => { app?.stopLedgerEvents(); await raw?.close(); });

describe('PostgreSQL unavailable', () => {
  it('answers 503, reports not ready, and submits nothing to the ledger', async () => {
    const blocks = Number((await one('SELECT count(*)::int AS n FROM local_ledger_blocks')).n);
    const submissions = control.submissions;
    net.down = true;
    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toMatchObject({ ok: false, database: { ok: false } });
    expect((await request(app).get('/api/health/live')).status).toBe(200);
    const created = await request(app).post('/api/shipments').set(as('Planner')).send({ partId: 'SP-020', location: 'Distribution Center', qty: 5, month: '2026-12', note: 'Database down' });
    expect(created.status).toBe(503);
    expect(created.body.error).toMatch(/database is not reachable/);
    expect((await request(app).get('/api/state').set(as('Admin'))).status).toBe(503);
    expect((await request(app).post('/api/auth/login').send({ email: 'planner@wethaq.demo', password: 'test-pass' })).status).toBe(503);
    net.down = false;
    expect(control.submissions).toBe(submissions);
    expect(Number((await one('SELECT count(*)::int AS n FROM local_ledger_blocks')).n)).toBe(blocks);
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
  });

  it('defers a transaction committed just before PostgreSQL went away, then applies it exactly once', async () => {
    const id = await requested();
    const before = await onHand('SP-020', 'LOC-CW');
    control.afterCommit = () => { net.down = true; };
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 5, note: 'Database lost after commit' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pending: true, ledgerState: 'pending' });
    // The ledger has the dispatch; PostgreSQL does not yet.
    expect((await base.read(id))?.status).toBe('Dispatched');
    expect((await one('SELECT status FROM shipments WHERE shipment_id = $1', [id])).status).toBe('Requested');
    net.down = false;
    // The event consumer subscribes again from its checkpoint and applies the missed commit.
    await expect.poll(async () => (await one('SELECT status, dispatched_qty FROM shipments WHERE shipment_id = $1', [id])), { timeout: 5_000 }).toMatchObject({ status: 'Dispatched', dispatched_qty: 5 });
    await reconcile(db, ledger, { pendingExpiryMs: 60_000, submittingGraceMs: 0 });
    expect(await onHand('SP-020', 'LOC-CW')).toBe(Math.max(0, before - 5));
    expect(Number((await one(`SELECT count(*)::int AS n FROM ledger_records WHERE shipment_id = $1 AND type = 'DISPATCH'`, [id])).n)).toBe(1);
    expect(Number((await one(`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id = $1 AND status = 'Dispatched'`, [id])).n)).toBe(1);
    expect((await one('SELECT applied_at IS NOT NULL AS applied FROM ledger_operations WHERE operation_id = $1', [res.body.txId])).applied).toBe(true);
  });
});

describe('API restart in the middle of an operation', () => {
  it('a new API process picks up a transaction the previous one committed but never recorded', async () => {
    const id = await requested();
    const before = await onHand('SP-020', 'LOC-CW');
    let hung: Promise<unknown> = Promise.resolve();
    // The "old process" dies right after the commit: its event consumer is gone and its request never completes.
    await app.sync.stop();
    control.afterCommit = () => new Promise(() => undefined);
    hung = request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 5, note: 'Process dies after commit' }).then(() => 'answered', () => 'aborted');
    await expect.poll(async () => (await base.read(id))?.status, { timeout: 5_000 }).toBe('Dispatched');
    expect((await one('SELECT status FROM shipments WHERE shipment_id = $1', [id])).status).toBe('Requested');
    expect((await one(`SELECT state FROM ledger_operations WHERE shipment_id = $1 AND kind = 'dispatch'`, [id])).state).toBe('submitting');

    // A new API process on the same database and ledger.
    const restarted = createApp({ db, ledger, config: { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: true, pendingExpiryMs: 60_000 } });
    try {
      await restarted.sync.ready;
      await expect.poll(async () => (await one('SELECT status FROM shipments WHERE shipment_id = $1', [id])).status, { timeout: 5_000 }).toBe('Dispatched');
      await restarted.sync.reconcile();
      expect(await onHand('SP-020', 'LOC-CW')).toBe(Math.max(0, before - 5));
      expect(Number((await one(`SELECT count(*)::int AS n FROM ledger_records WHERE shipment_id = $1 AND type = 'DISPATCH'`, [id])).n)).toBe(1);
      const verify = await request(restarted).get(`/api/shipments/${id}/verify`).set(as('Admin'));
      expect(verify.body).toMatchObject({ status: 'verified', match: true });
      app = restarted; // later tests use the running process
    } finally {
      void hung;
    }
  });
});

describe('concurrent operations on the same shipment', () => {
  it('two simultaneous dispatches: exactly one commits, stock moves once', async () => {
    const id = await requested();
    const before = await onHand('SP-020', 'LOC-CW');
    const [a, b] = await Promise.all([
      request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 5, note: 'first' }),
      request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 5, note: 'second' })
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);
    expect(Number((await one(`SELECT count(*)::int AS n FROM ledger_records WHERE shipment_id = $1 AND type = 'DISPATCH' AND status = 'Committed'`, [id])).n)).toBe(1);
    expect(await onHand('SP-020', 'LOC-CW')).toBe(Math.max(0, before - 5));
    expect((await one('SELECT status, dispatched_qty FROM shipments WHERE shipment_id = $1', [id]))).toMatchObject({ status: 'Dispatched', dispatched_qty: 5 });
  });

  it('a receipt racing a second receipt: one is committed, the duplicate is rejected', async () => {
    const id = await requested();
    await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 5 }).expect(200);
    const before = await onHand('SP-020', 'LOC-DC');
    const [a, b] = await Promise.all([
      request(app).post(`/api/shipments/${id}/receive`).set(as('Receiver')).send({ qty: 5 }),
      request(app).post(`/api/shipments/${id}/receive`).set(as('Receiver')).send({ qty: 5 })
    ]);
    expect([a.status, b.status].sort()[0]).toBe(200);
    expect([409, 422]).toContain([a.status, b.status].sort()[1]);
    expect(await onHand('SP-020', 'LOC-DC')).toBe(before + 5);
    expect((await one('SELECT status, received_qty FROM shipments WHERE shipment_id = $1', [id]))).toMatchObject({ status: 'Received', received_qty: 5 });
  });

  it('the same Idempotency-Key sent twice at once creates one shipment', async () => {
    const key = 'concurrent-' + Date.now();
    const send = () => request(app).post('/api/shipments').set({ ...as('Planner'), 'Idempotency-Key': key }).send({ partId: 'SP-020', location: 'Distribution Center', qty: 2, month: '2026-12', note: 'Concurrent key' });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.body.id).toBe(b.body.id);
    expect(Number((await one(`SELECT count(*)::int AS n FROM ledger_operations WHERE idempotency_key = $1`, [key])).n)).toBe(1);
  });
});

void wait;
