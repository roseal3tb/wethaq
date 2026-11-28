/**
 * Integration tests against a running Hyperledger Fabric network and a running API in fabric mode.
 * Skipped unless FABRIC_IT=1. Run them with:
 *   ./fabric/up.sh
 *   (in wethaq-api) LEDGER_MODE=fabric npm run seed -- --reset && LEDGER_MODE=fabric npm run dev
 *   FABRIC_IT=1 DEMO_PASSWORD=... npx vitest run test/fabric.integration.test.ts
 */
import '../src/env.js'; // wethaq-api/.env (DATABASE_URL, DEMO_PASSWORD, Fabric settings)
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { postgres, type Db } from '../src/db.js';
import { createLedger } from '../src/ledger/index.js';
import type { Ledger } from '../src/ledger/types.js';

const RUN = process.env.FABRIC_IT === '1';
const API = process.env.API_URL || 'http://127.0.0.1:4000/api';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo';
const tokens: Record<string, string> = {};
let db: Db; let client: Ledger;

async function call(method: string, path: string, role?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}
const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 250)); }
};

describe.runIf(RUN)('Hyperledger Fabric integration', () => {
  beforeAll(async () => {
    const config = { ...loadConfig(), ledgerMode: 'fabric' as const };
    db = postgres(config.databaseUrl);
    client = await createLedger(config, db); // a second, independent client of the network
    for (const role of ['planner', 'dispatcher', 'receiver', 'admin']) {
      const res = await call('POST', '/auth/login', undefined, { email: `${role}@wethaq.demo`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[role] = res.body.token;
    }
  });
  afterAll(async () => { await client?.close(); await db?.close(); });

  let id: string;
  it('reports the Fabric network ready, with CA-enrolled application identities', async () => {
    const ready = await call('GET', '/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.ledger).toBe('fabric');
    expect(ready.body.ledgerHealth.identities.map((i: any) => i.msp)).toEqual(['Org1MSP', 'Org2MSP']);
    expect(ready.body.ledgerHealth.identities.every((i: any) => i.subject.includes('CN=wethaq-app') && i.daysLeft > 30)).toBe(true);
  });

  it('commits a request on Fabric (Case A) and verifies it on the peer', async () => {
    const res = await call('POST', '/shipments', 'planner', { partId: 'SP-012', location: 'Deployment Site', qty: 7, month: '2026-12', note: 'Fabric integration test' });
    expect(res.status).toBe(201);
    expect(res.body.txId).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.block).toBeGreaterThan(0);
    id = res.body.id;
    const status = await client.transactionStatus(res.body.txId);
    expect(status).toMatchObject({ state: 'valid', code: 'VALID', block: res.body.block });
    const verify = await call('GET', `/shipments/${id}/verify`, 'admin');
    expect(verify.body).toMatchObject({ status: 'verified', onLedger: true, match: true, ledgerKind: 'fabric', lastTxId: res.body.txId });
  });

  it('records a chaincode rejection on the ledger (Case B)', async () => {
    const res = await call('POST', `/shipments/${id}/dispatch`, 'dispatcher', { qty: 99 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ passed: false, source: 'chaincode', failedRule: 'validQuantity' });
    const record = await client.readRecord(res.body.txId);
    expect(record).toMatchObject({ status: 'Rejected', failedRule: 'validQuantity', shipmentId: id });
  });

  it('replays an Idempotency-Key instead of submitting twice', async () => {
    const key = { 'Idempotency-Key': `it-${randomBytes(6).toString('hex')}` };
    const a = await call('POST', `/shipments/${id}/dispatch`, 'dispatcher', { qty: 7 }, key);
    const b = await call('POST', `/shipments/${id}/dispatch`, 'dispatcher', { qty: 7 }, key);
    expect(a.status).toBe(200);
    expect(b.body.txId).toBe(a.body.txId);
    const history = await client.history(id);
    expect(history.filter(r => r.operation === 'dispatch' && r.status === 'Committed')).toHaveLength(1);
  });

  it('applies a transaction submitted by another client from the chaincode event stream', async () => {
    const outcome = await client.submit({ operation: 'transit', shipmentId: id, qty: 0, org: 'Org1MSP' });
    expect(outcome.passed).toBe(true);
    const row = await waitFor(async () => (await db.query<any>('SELECT status, last_tx_id FROM shipments WHERE shipment_id = $1 AND last_tx_id = $2', [id, outcome.txId])).rows[0]);
    expect(row.status).toBe('In Transit');
    const records = (await db.query<any>('SELECT user_name, block FROM ledger_records WHERE tx_id = $1', [outcome.txId])).rows;
    expect(records).toHaveLength(1);
    expect(records[0].user_name).toContain('ledger client');
    const sync = await call('GET', '/admin/sync-status', 'admin');
    expect(sync.body.checkpoint.block).toBeGreaterThanOrEqual(outcome.block!);
  });

  it('answers not_found for a transaction id the ledger never saw', async () => {
    expect((await client.transactionStatus(randomBytes(32).toString('hex'))).state).toBe('not_found');
  });

  it('pages through the ledger records of a shipment with QueryTransactionRecords', async () => {
    const all = await client.history(id);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.map(r => r.operation)).toEqual(expect.arrayContaining(['request', 'dispatch', 'transit']));
  });

  describe('chaincode version 2: cancellation, partial receipts and returns (B5)', () => {
    const create = async (qty: number) => {
      const res = await call('POST', '/shipments', 'planner', { partId: 'SP-012', location: 'Deployment Site', qty, month: '2026-12', note: 'Fabric integration test, version 2' });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const step = async (role: string, shipmentId: string, path: string, qty = 0) => {
      const res = await call('POST', `/shipments/${shipmentId}/${path}`, role, { qty, note: 'Fabric integration test' });
      expect(res.status, `${path}: ${res.body.reason ?? res.body.error}`).toBe(200);
      expect((await client.transactionStatus(res.body.txId)).state).toBe('valid');
      return res.body;
    };

    it('cancels a dispatched shipment on Fabric and verifies it on the peer', async () => {
      const shipmentId = await create(5);
      await step('dispatcher', shipmentId, 'dispatch', 5);
      await step('dispatcher', shipmentId, 'cancel');
      expect(await client.read(shipmentId)).toMatchObject({ status: 'Cancelled', dispatchedQty: 5 });
      expect((await call('GET', `/shipments/${shipmentId}/verify`, 'admin')).body).toMatchObject({ status: 'verified', match: true });
    });

    it('records partial receipts and a return on Fabric', async () => {
      const shipmentId = await create(9);
      await step('dispatcher', shipmentId, 'dispatch', 9);
      await step('receiver', shipmentId, 'receive-partial', 4);
      expect(await client.read(shipmentId)).toMatchObject({ status: 'Partially Received', receivedQty: 4 });
      const over = await call('POST', `/shipments/${shipmentId}/receive`, 'receiver', { qty: 6 });
      expect(over.status).toBe(422);
      expect((await client.readRecord(over.body.txId))).toMatchObject({ status: 'Rejected', failedRule: 'validQuantity' });
      await step('receiver', shipmentId, 'receive', 5);
      await step('receiver', shipmentId, 'return', 2);
      expect(await client.read(shipmentId)).toMatchObject({ status: 'Returned', receivedQty: 9, returnedQty: 2 });
      expect((await call('GET', `/shipments/${shipmentId}/verify`, 'admin')).body).toMatchObject({ status: 'verified', match: true });
      const ops = (await client.history(shipmentId)).map(r => `${r.operation}:${r.status}`);
      expect(ops).toEqual(['request:Committed', 'dispatch:Committed', 'receivePartial:Committed', 'receive:Rejected', 'receive:Committed', 'return:Committed']);
    });
  });
});
