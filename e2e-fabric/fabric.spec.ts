import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * The complete workflow on the real Fabric network, through the dashboard in live mode:
 * planner → forecasts → inventory → request → dispatch → in transit → receipt, with independent checks
 * that Fabric committed each transaction (peer CLI, not the API) and that PostgreSQL holds the same state,
 * then a rejected operation, alerts, and an API restart. Nothing here is mocked.
 */

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'wethaq-api');
const API = 'http://127.0.0.1:4000/api';
const requireApi = createRequire(path.join(API_DIR, 'package.json'));

function apiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const file = path.join(API_DIR, '.env');
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2];
  }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.LEDGER_MODE = 'fabric';
  return env;
}

let api: ChildProcess | undefined;
async function startApi() {
  const env = apiEnv();
  api = spawn('npx', ['tsx', 'src/server.ts'], { cwd: API_DIR, env, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    const ready = await fetch(`${API}/health/ready`).then(r => r.json(), () => null) as { ok: boolean; ledger: string } | null;
    if (ready?.ok) { expect(ready.ledger).toBe('fabric'); return; }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('The API did not become ready with the Fabric ledger within two minutes');
}
async function stopApi() {
  if (!api?.pid) return;
  const exited = new Promise(r => api!.once('exit', r));
  process.kill(-api.pid, 'SIGTERM');
  await Promise.race([exited, new Promise(r => setTimeout(r, 15_000))]);
  api = undefined;
  for (let i = 0; i < 30; i++) { if (!(await fetch(`${API}/health/live`).then(() => true, () => false))) return; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('The API is still answering after it was stopped');
}

/** Reads the ledger with the peer CLI on peer0.org2: independent of the API and of PostgreSQL. */
function peerQuery(kind: 'tx' | 'history' | 'shipment', id: string) {
  const out = execFileSync(path.join(ROOT, 'fabric/query.sh'), [kind, id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return out ? JSON.parse(out) : null;
}

async function pg<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { Client } = requireApi('pg') as typeof import('pg');
  const client = new Client({ connectionString: apiEnv().DATABASE_URL || 'postgres://wethaq:wethaq@127.0.0.1:5434/wethaq' });
  await client.connect();
  try { return (await client.query(sql, params)).rows as T[]; } finally { await client.end(); }
}

async function token(request: APIRequestContext, who: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email: `${who}@wethaq.demo`, password: process.env.DEMO_PASSWORD || 'demo' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token as string;
}

async function signIn(page: Page, who: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${who}@wethaq.demo`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD || 'demo');
  await page.getByRole('button', { name: 'Sign in to Wethaq' }).click();
  await expect(page).toHaveURL(/\/overview/);
}
async function switchRole(page: Page, role: string) {
  await page.getByRole('button', { name: /Demo role:/ }).click();
  await page.getByRole('menuitemradio', { name: role, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Demo role: ' + role })).toBeVisible();
}
async function submit(page: Page, label: RegExp) {
  await page.getByRole('button', { name: 'Submit to ledger' }).click();
  await expect(page.getByText(label)).toBeVisible();
}

test.beforeAll(async () => {
  if (await fetch(`${API}/health/live`).then(() => true, () => false)) throw new Error('Stop the API on port 4000 first: this test starts and restarts it itself');
  await startApi();
});
test.afterAll(async () => { await stopApi(); });

test('The full workflow runs on Hyperledger Fabric and survives an API restart', async ({ page, request }) => {
  const admin = await token(request, 'admin');
  const auth = { Authorization: `Bearer ${admin}` };
  const position = async (partId: string, location: string) =>
    ((await (await request.get(`${API}/inventory?partId=${partId}`, { headers: auth })).json()) as { location: string; onHand: number; inTransit: number }[]).find(p => p.location === location)!;
  let shipmentId = '';
  let from = ''; let to = '';
  let before = { from: 0, to: 0 };
  const txIds: string[] = [];

  await test.step('1. The planner signs in', async () => {
    await signIn(page, 'planner');
    await expect(page.getByRole('button', { name: 'Demo role: Logistics Planner' })).toBeVisible();
  });

  await test.step('2. The planner reviews forecasts read from the API', async () => {
    const sha = createHash('sha256').update(readFileSync('analysis/results/raf-forecasts.json')).digest('hex');
    await page.goto('/forecasts');
    await expect(page.getByText(`From the API · analysis/results/raf-forecasts.json · ${sha.slice(0, 8)}`)).toBeVisible();
  });

  await test.step('3. The planner reviews inventory computed by the API', async () => {
    await page.goto('/inventory?search=SP-001&location=Distribution+Center');
    await expect(page.locator('tbody tr').first()).toContainText('SP-001');
  });

  await test.step('4. The planner creates a shipment request', async () => {
    await page.locator('tbody tr').first().press('Enter');
    await page.getByRole('button', { name: 'Create shipment request' }).click();
    await page.getByRole('spinbutton', { name: 'Requested quantity' }).fill('4');
    await page.getByRole('textbox', { name: 'Review note (required)' }).fill('Fabric end-to-end test');
    await page.getByRole('button', { name: 'Confirm request' }).click();
    await expect(page).toHaveURL(/\/shipments\?search=SHP-/);
    shipmentId = new URL(page.url()).searchParams.get('search')!;
    await expect(page.locator('tbody tr').filter({ hasText: shipmentId })).toContainText('Requested');
    const [row] = await pg<{ from_location: string; to_location: string }>('SELECT from_location, to_location FROM shipments WHERE shipment_id = $1', [shipmentId]);
    const state = await (await request.get(`${API}/state`, { headers: auth })).json() as { shipments: { id: string; from: string; to: string }[] };
    const s = state.shipments.find(x => x.id === shipmentId)!;
    from = s.from; to = s.to;
    expect(row).toBeTruthy();
    before = { from: (await position('SP-001', from)).onHand, to: (await position('SP-001', to)).onHand };
  });

  await test.step('5. Fabric committed the request (read from the peer, not the API)', async () => {
    const onPeer = peerQuery('shipment', shipmentId);
    expect(onPeer).toMatchObject({ shipmentId, partId: 'SP-001', requestedQty: 4, status: 'Requested' });
    const history = peerQuery('history', shipmentId) as { txId: string; operation: string; status: string }[];
    expect(history.map(r => r.operation)).toEqual(['request']);
    txIds.push(history[0].txId);
  });

  await test.step('6. PostgreSQL holds the same transaction', async () => {
    await expect.poll(async () => (await pg('SELECT ledger_state, last_tx_id FROM shipments WHERE shipment_id = $1', [shipmentId]))[0]).toEqual({ ledger_state: 'confirmed', last_tx_id: txIds[0] });
    const [rec] = await pg<{ block: string }>('SELECT block FROM ledger_records WHERE tx_id = $1', [txIds[0]]);
    expect(Number(rec.block)).toBeGreaterThan(0);
  });

  const record = () => page.locator('tbody tr').filter({ hasText: shipmentId });

  await test.step('7. The dispatcher records the dispatch', async () => {
    await switchRole(page, 'Dispatcher');
    await record().press('Enter');
    await page.getByRole('button', { name: 'Record dispatch' }).click();
    await submit(page, /committed on Fabric · block \d+/);
  });

  await test.step('8. The dispatcher marks the shipment in transit', async () => {
    await page.getByRole('button', { name: 'Mark in transit' }).click();
    await submit(page, /committed on Fabric · block \d+/);
    await page.getByRole('button', { name: 'Close detail panel' }).click();
    await expect(record()).toContainText('In Transit');
  });

  await test.step('9. The receiver confirms receipt of 3 of the 4 units', async () => {
    await switchRole(page, 'Receiver');
    await record().press('Enter');
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await page.getByRole('spinbutton', { name: 'Received quantity' }).fill('3');
    await submit(page, /committed on Fabric · block \d+/);
    await page.getByRole('button', { name: 'Close detail panel' }).click();
    await expect(record()).toContainText('Received');
  });

  await test.step('10. Fabric and PostgreSQL agree on all four transactions', async () => {
    const history = peerQuery('history', shipmentId) as { txId: string; operation: string; status: string; quantity: number }[];
    expect(history.map(r => r.operation).sort()).toEqual(['dispatch', 'receive', 'request', 'transit']);
    for (const r of history) {
      expect(r.txId).toMatch(/^[0-9a-f]{64}$/);
      expect(peerQuery('tx', r.txId)).toMatchObject({ txId: r.txId, shipmentId });
    }
    await expect.poll(async () => (await pg<{ tx_id: string }>('SELECT tx_id FROM ledger_records WHERE shipment_id = $1 AND tx_id IS NOT NULL ORDER BY tx_id', [shipmentId])).map(r => r.tx_id)).toEqual(history.map(r => r.txId).sort());
    const [row] = await pg('SELECT status, dispatched_qty, received_qty, ledger_state FROM shipments WHERE shipment_id = $1', [shipmentId]);
    expect(row).toEqual({ status: 'Received', dispatched_qty: 4, received_qty: 3, ledger_state: 'confirmed' });
    expect(peerQuery('shipment', shipmentId)).toMatchObject({ status: 'Received', dispatchedQty: 4, receivedQty: 3 });
    txIds.splice(0, txIds.length, ...history.map(r => r.txId));
  });

  await test.step('11. Inventory changed by the dispatched and received quantities', async () => {
    if (from !== to) expect((await position('SP-001', from)).onHand).toBe(Math.max(0, before.from - 4));
    expect((await position('SP-001', to)).onHand).toBe(before.to + 3 - (from === to ? 4 : 0));
  });

  await test.step('12. The Ledger tab shows the Fabric transaction ids and blocks', async () => {
    await page.goto(`/shipments?tab=ledger&search=${shipmentId}`);
    // The Ledger tab lists the movement transactions (dispatch, in transit, receipt); the request is shown in the journey.
    const rows = page.locator('tbody tr').filter({ hasText: shipmentId }).filter({ hasText: /Committed/ });
    await expect(rows).toHaveCount(3);
    const [request] = await pg<{ tx_id: string; block: string }>(`SELECT tx_id, block FROM ledger_records WHERE shipment_id = $1 AND type = 'REQUEST'`, [shipmentId]);
    const movements = await pg<{ tx_id: string; block: string }>(`SELECT tx_id, block FROM ledger_records WHERE shipment_id = $1 AND type <> 'REQUEST' AND tx_id IS NOT NULL`, [shipmentId]);
    expect(movements).toHaveLength(3);
    for (const m of movements) await expect(page.locator('tbody tr').filter({ hasText: m.tx_id }).filter({ hasText: String(m.block) })).toHaveCount(1);
    expect(txIds).toContain(request.tx_id);
  });

  await test.step('13. Verification against the ledger succeeds', async () => {
    await page.goto(`/shipments?search=${shipmentId}`);
    await record().press('Enter');
    await page.getByRole('button', { name: 'Verify against ledger' }).click();
    await expect(page.getByText('The database record matches the ledger')).toBeVisible();
    await page.getByRole('button', { name: 'Close detail panel' }).click();
  });

  await test.step('14. Invalid operations are rejected: a second receipt by the chaincode, a dispatch by the receiver by the application', async () => {
    const receiver = await token(request, 'receiver');
    const again = await request.post(`${API}/shipments/${shipmentId}/receive`, { headers: { Authorization: `Bearer ${receiver}` }, data: { qty: 1, note: 'Duplicate receipt' } });
    expect(again.status()).toBe(422);
    const body = await again.json();
    expect(body).toMatchObject({ passed: false, source: 'chaincode' });
    const wrongRole = await request.post(`${API}/shipments/${shipmentId}/dispatch`, { headers: { Authorization: `Bearer ${receiver}` }, data: { qty: 1, note: 'Wrong role' } });
    expect(wrongRole.status()).toBe(422);
    expect(await wrongRole.json()).toMatchObject({ passed: false, source: 'application' });
    const [row] = await pg('SELECT status, received_qty FROM shipments WHERE shipment_id = $1', [shipmentId]);
    expect(row).toEqual({ status: 'Received', received_qty: 3 });
    expect(peerQuery('shipment', shipmentId)).toMatchObject({ status: 'Received', receivedQty: 3 });
  });

  await test.step('15. Alerts were created for the discrepancy and the rejected attempt', async () => {
    await page.goto(`/inventory?tab=alerts&search=${shipmentId}`);
    const alerts = page.locator('tbody tr');
    await expect(alerts.filter({ hasText: 'Receipt quantity mismatch' })).toHaveCount(1);
    await expect(alerts.filter({ hasText: 'Rejected attempt' }).first()).toBeVisible();
  });

  await test.step('16. The receiver acknowledges the discrepancy alert', async () => {
    const row = page.locator('tbody tr').filter({ hasText: 'Receipt quantity mismatch' });
    await row.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(row.getByRole('button', { name: 'Reviewed' })).toBeVisible();
    const [alert] = await pg<{ acknowledged: boolean }>(`SELECT acknowledged FROM alerts WHERE dedupe_key = $1`, [`discrepancy:${shipmentId}`]);
    expect(alert.acknowledged).toBe(true);
  });

  await test.step('17. After an API restart the data is still there and still verifies', async () => {
    await stopApi();
    await startApi();
    await page.goto(`/shipments?tab=ledger&search=${shipmentId}`);
    await expect(page.locator('tbody tr').filter({ hasText: shipmentId }).filter({ hasText: /Committed/ })).toHaveCount(3);
    await page.goto(`/shipments?search=${shipmentId}`);
    await expect(record()).toContainText('Received');
    await record().press('Enter');
    await page.getByRole('button', { name: 'Verify against ledger' }).click();
    await expect(page.getByText('The database record matches the ledger')).toBeVisible();
    await page.goto(`/inventory?tab=alerts&search=${shipmentId}`);
    await expect(page.locator('tbody tr').filter({ hasText: 'Receipt quantity mismatch' }).getByRole('button', { name: 'Reviewed' })).toBeVisible();
  });
});
