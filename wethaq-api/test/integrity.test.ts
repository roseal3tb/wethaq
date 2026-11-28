/**
 * Database integrity (migration 004), the list and traceability endpoints, the consistency check between
 * PostgreSQL and the ledger, and the startup check of the event checkpoint after the ledger goes back in time
 * (as after restoring Fabric from an older backup). The ledger here is the local development ledger: these
 * tests check the API's logic, not Hyperledger Fabric itself (see fabric.integration.test.ts and
 * docs/gp482/BACKUP_AND_RECOVERY.md for the restore run on a real Fabric network).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { splitSql, type Db } from '../src/db.js';
import { localLedger } from '../src/ledger/local.js';
import type { Ledger } from '../src/ledger/types.js';
import { seed } from '../src/seed.js';
import { testDb } from './helpers.js';

let db: Db; let ledger: Ledger; let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
const config = { jwtSecret: 'test-secret', jwtTtl: '1h', demoRoleSwitch: true };
const settle = (ms = 50) => new Promise(r => setTimeout(r, ms));
const one = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await testDb();
  ledger = localLedger(db);
  await seed(db, ledger, { password: 'test-pass' });
  app = createApp({ db, ledger, config });
  for (const role of ['planner', 'dispatcher', 'receiver', 'admin']) {
    const res = await request(app).post('/api/auth/login').send({ email: `${role}@wethaq.demo`, password: 'test-pass' });
    tokens[role[0].toUpperCase() + role.slice(1)] = res.body.token;
  }
});
afterAll(async () => { app?.stopLedgerEvents(); await db?.close(); });

describe('migrations', () => {
  it('keeps a dollar-quoted function body as one statement', () => {
    const parts = splitSql("CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  RAISE EXCEPTION 'x';\nEND\n$$;\nSELECT 1; -- comment\n");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("RAISE EXCEPTION 'x';");
    expect(parts[1]).toBe('SELECT 1');
  });
  it('records every migration once', async () => {
    const names = (await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
    expect(names).toEqual(['001_init.sql', '002_password_policy.sql', '003_ledger_sync.sql', '004_integrity.sql', '005_sessions.sql', '006_cancel_partial_return.sql']);
  });
});

describe('integrity constraints', () => {
  it('refuses a dispatched quantity above the requested quantity', async () => {
    const s = await one(`SELECT shipment_id, requested_qty FROM shipments WHERE status = 'Dispatched' LIMIT 1`);
    await expect(db.query('UPDATE shipments SET dispatched_qty = $2 WHERE shipment_id = $1', [s.shipment_id, s.requested_qty + 1])).rejects.toThrow(/shipments_dispatched_le_requested/);
  });
  it('refuses a received quantity above the dispatched quantity, or a receipt with no dispatch', async () => {
    const s = await one(`SELECT shipment_id, dispatched_qty FROM shipments WHERE status = 'Received' LIMIT 1`);
    await expect(db.query('UPDATE shipments SET received_qty = $2 WHERE shipment_id = $1', [s.shipment_id, s.dispatched_qty + 1])).rejects.toThrow(/shipments_received_le_dispatched/);
    const r = await one(`SELECT shipment_id FROM shipments WHERE status = 'Requested' LIMIT 1`);
    await expect(db.query('UPDATE shipments SET received_qty = 1 WHERE shipment_id = $1', [r.shipment_id])).rejects.toThrow(/shipments_received_le_dispatched/);
  });
  it('refuses a status that does not match the quantities', async () => {
    const r = await one(`SELECT shipment_id FROM shipments WHERE status = 'Requested' LIMIT 1`);
    await expect(db.query(`UPDATE shipments SET status = 'Received' WHERE shipment_id = $1`, [r.shipment_id])).rejects.toThrow(/shipments_status_quantities/);
  });
  it('refuses a shipment for an unknown part (foreign key)', async () => {
    await expect(db.query(`INSERT INTO shipments (shipment_id, part_id, requested_qty, from_location, to_location, status, requested_by, expected_at, forecast_month, review_note)
      VALUES ('SHP-X', 'SP-999', 1, 'Supplier', 'LOC-CW', 'Requested', 'USR-001', now(), '2026-12', 'x')`)).rejects.toThrow(/foreign key/);
  });
  it('keeps the audit log append-only', async () => {
    const before = (await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).n;
    await db.query(`INSERT INTO audit_log (action, outcome) VALUES ('test.append', 'ok')`);
    await expect(db.query(`UPDATE audit_log SET outcome = 'denied' WHERE action = 'test.append'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM audit_log WHERE action = 'test.append'`)).rejects.toThrow(/append-only/);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).n).toBe(before + 1);
  });
});

describe('lists and traceability', () => {
  it('pages through shipments with a total, newest first', async () => {
    const first = (await request(app).get('/api/shipments?limit=10').set(as('Planner'))).body;
    const second = (await request(app).get('/api/shipments?limit=10&offset=10').set(as('Planner'))).body;
    expect(first.total).toBe(48);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(first.items.map((s: any) => s.id)).not.toContain(second.items[0].id);
    expect(new Date(first.items[0].requestedAt) >= new Date(first.items[9].requestedAt)).toBe(true);
    expect(Array.isArray(first.items[0].events)).toBe(true);
  });
  it('filters shipments by status and destination', async () => {
    const res = (await request(app).get('/api/shipments?status=Received&location=Distribution%20Center&limit=200').set(as('Planner'))).body;
    expect(res.items.length).toBe(res.total);
    expect(res.items.every((s: any) => s.status === 'Received' && s.to === 'Distribution Center')).toBe(true);
  });
  it('rejects invalid filters and page sizes', async () => {
    expect((await request(app).get('/api/shipments?status=Lost').set(as('Planner'))).status).toBe(400);
    expect((await request(app).get('/api/shipments?limit=0').set(as('Planner'))).status).toBe(400);
    expect((await request(app).get('/api/shipments?limit=500').set(as('Planner'))).status).toBe(400);
    expect((await request(app).get("/api/ledger/records?shipmentId=x'%20OR%201=1").set(as('Planner'))).status).toBe(400);
    expect((await request(app).get('/api/ledger/records?from=yesterday').set(as('Planner'))).status).toBe(400);
    expect((await request(app).get('/api/alerts?acknowledged=maybe').set(as('Planner'))).status).toBe(400);
  });
  it('requires a signed-in user for the lists', async () => {
    for (const path of ['/api/shipments', '/api/shipments/SHP-2026-0001', '/api/ledger/records', '/api/alerts']) expect((await request(app).get(path)).status).toBe(401);
  });
  it('lists ledger records and rejected attempts with filters', async () => {
    const rejected = (await request(app).get('/api/ledger/records?status=Rejected&limit=200').set(as('Receiver'))).body;
    expect(rejected.total).toBeGreaterThanOrEqual(5);
    expect(rejected.items.every((r: any) => r.status === 'Rejected')).toBe(true);
    const requests = (await request(app).get('/api/ledger/records?type=REQUEST&limit=1').set(as('Receiver'))).body;
    expect(requests.total).toBe(48);
  });
  it('lists open alerts', async () => {
    const res = (await request(app).get('/api/alerts?acknowledged=false&limit=200').set(as('Planner'))).body;
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.every((a: any) => a.acknowledged === false)).toBe(true);
  });
  it('traces one shipment from request to receipt, with the ledger history', async () => {
    const id = (await one(`SELECT shipment_id FROM shipments WHERE status = 'Received' ORDER BY shipment_id LIMIT 1`)).shipment_id;
    const res = await request(app).get(`/api/shipments/${id}`).set(as('Receiver'));
    expect(res.status).toBe(200);
    expect(res.body.shipment).toMatchObject({ id, status: 'Received' });
    expect(res.body.records.map((r: any) => r.type)).toEqual(expect.arrayContaining(['REQUEST', 'DISPATCH', 'RECEIPT']));
    expect(res.body.ledger.kind).toBe('local');
    const onLedger = res.body.ledger.history.map((h: any) => h.txId);
    expect(res.body.records.filter((r: any) => r.source === 'chaincode').every((r: any) => onLedger.includes(r.hash))).toBe(true);
    expect((await request(app).get('/api/shipments/SHP-0000-0000').set(as('Receiver'))).status).toBe(404);
    expect((await request(app).get('/api/shipments/bad%20id').set(as('Receiver'))).status).toBe(400);
  });
  it('filters the audit log and pages it by id', async () => {
    const page1 = (await request(app).get('/api/admin/audit?action=auth.login&limit=2').set(as('Admin'))).body;
    expect(page1).toHaveLength(2);
    expect(page1.every((r: any) => r.action === 'auth.login')).toBe(true);
    const page2 = (await request(app).get(`/api/admin/audit?action=auth.login&limit=2&before=${page1[1].id}`).set(as('Admin'))).body;
    expect(page2.every((r: any) => r.id < page1[1].id)).toBe(true);
    expect((await request(app).get('/api/admin/audit').set(as('Planner'))).status).toBe(403);
  });
});

describe('consistency between PostgreSQL and the ledger', () => {
  it('reports the seeded data as consistent', async () => {
    const res = await request(app).get('/api/admin/consistency').set(as('Admin'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ consistent: true, ledger: 'local', truncated: false });
    expect(res.body.summary).toMatchObject({ shipments: 48, verified: 48, mismatch: 0, notFound: 0, recordsMissingOnLedger: 0, recordsMissingInDatabase: 0 });
    expect((await one(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ledger.consistency_check'`)).n).toBe(1);
  });
  it('is for administrators only', async () => {
    expect((await request(app).get('/api/admin/consistency').set(as('Dispatcher'))).status).toBe(403);
  });
  it('finds a reporting copy that was changed outside the API', async () => {
    const s = await one(`SELECT shipment_id, requested_qty FROM shipments WHERE status = 'Requested' AND ledger_state = 'confirmed' ORDER BY shipment_id LIMIT 1`);
    await db.query('UPDATE shipments SET requested_qty = requested_qty + 1 WHERE shipment_id = $1', [s.shipment_id]);
    const res = (await request(app).get('/api/admin/consistency').set(as('Admin'))).body;
    expect(res.consistent).toBe(false);
    expect(res.summary.mismatch).toBe(1);
    expect(res.problems.find((p: any) => p.shipmentId === s.shipment_id)).toMatchObject({ status: 'mismatch' });
    await db.query('UPDATE shipments SET requested_qty = $2 WHERE shipment_id = $1', [s.shipment_id, s.requested_qty]);
    expect((await request(app).get('/api/admin/consistency').set(as('Admin'))).body.consistent).toBe(true);
  });
});

describe('the ledger goes back in time (restored from an older backup)', () => {
  it('detects the checkpoint ahead of the ledger at startup, follows new blocks, and reports what is missing', async () => {
    // A dispatch through the API: PostgreSQL applies it and the event checkpoint moves to its block.
    const id = (await one(`SELECT shipment_id FROM shipments WHERE status = 'Requested' AND ledger_state = 'confirmed' ORDER BY shipment_id LIMIT 1`)).shipment_id;
    const ledgerBefore = await ledger.read(id);
    const res = await request(app).post(`/api/shipments/${id}/dispatch`).set(as('Dispatcher')).send({ qty: 1 });
    expect(res.status).toBe(200);
    await settle();
    const cp = await one<{ block: number }>(`SELECT block FROM event_checkpoints WHERE name = 'ledger-events'`);
    expect(Number(cp.block)).toBe(res.body.block);

    // "Restore" the ledger to the state before that block: the block and the shipment's new state disappear,
    // and the next transaction will reuse the block number, as on a restored Fabric channel.
    app.stopLedgerEvents();
    await db.query('DELETE FROM local_ledger_blocks WHERE block >= $1', [res.body.block]);
    await db.query('UPDATE local_ledger_state SET value = $2 WHERE key = $1', [id, JSON.stringify(ledgerBefore)]);
    await db.query(`SELECT setval(pg_get_serial_sequence('local_ledger_blocks', 'block'), $1)`, [res.body.block - 1]);

    const restarted = createApp({ db, ledger, config });
    await restarted.sync.ready;
    const status = (await request(restarted).get('/api/admin/sync-status').set(as('Admin'))).body;
    expect(status.consumer.checkpointReset).toMatchObject({ fromBlock: res.body.block, toBlock: res.body.block - 1, ledgerHeight: res.body.block });
    expect(Number((await one(`SELECT block FROM event_checkpoints WHERE name = 'ledger-events'`)).block)).toBe(res.body.block - 1);
    expect(await one(`SELECT severity FROM alerts WHERE dedupe_key = 'ledger-sync:checkpoint-ahead' AND NOT acknowledged`)).toMatchObject({ severity: 'Critical' });
    expect((await one(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ledger.checkpoint_reset'`)).n).toBe(1);

    // The consistency check names the shipment and the transaction the ledger no longer has. Nothing is deleted.
    const report = (await request(restarted).get('/api/admin/consistency').set(as('Admin'))).body;
    expect(report.consistent).toBe(false);
    expect(report.problems.find((p: any) => p.shipmentId === id)).toMatchObject({ status: 'mismatch', missingOnLedger: [res.body.txId] });
    expect((await one('SELECT status FROM shipments WHERE shipment_id = $1', [id])).status).toBe('Dispatched');

    // A transaction from another client of the network reuses the block number and is still applied.
    const other = (await one(`SELECT shipment_id FROM shipments WHERE status = 'Requested' AND ledger_state = 'confirmed' AND shipment_id <> $1 ORDER BY shipment_id LIMIT 1`, [id])).shipment_id;
    const outside = await ledger.submit({ operation: 'dispatch', shipmentId: other, qty: 1, org: 'Org1MSP' });
    expect(outside.block).toBe(res.body.block);
    await settle(100);
    expect(await one('SELECT status, dispatched_qty FROM shipments WHERE shipment_id = $1', [other])).toMatchObject({ status: 'Dispatched', dispatched_qty: 1 });
    restarted.stopLedgerEvents();
  });
});
