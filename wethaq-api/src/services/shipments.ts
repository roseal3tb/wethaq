import type { Db, Queryable } from '../db.js';
import type { Ledger, LedgerOperation, LedgerOutcome, OrgMsp } from '../ledger/types.js';
import { checkRules } from '../../../chaincode/shipment/src/rules.js';
import { allowed, type ApiUser } from '../auth.js';
import { HttpError, locationId, orgName, recordId, shortId } from './common.js';

/** The response the dashboard's live client expects for a ledger operation (src/api/live.ts, LedgerResult). */
export interface LedgerResult {
  passed: boolean; failure?: string; failedRule?: string; reason?: string;
  source?: 'chaincode' | 'application'; transactionId: string; txId?: string; block?: number;
}

const TX_TYPE: Record<LedgerOperation, string> = { dispatch: 'DISPATCH', transit: 'STATUS_CHANGE', receive: 'RECEIPT' };
const ACTION_LABEL: Record<LedgerOperation, string> = { dispatch: 'dispatch', transit: 'in-transit update', receive: 'receipt' };

interface ShipmentRow { shipment_id: string; part_id: string; requested_qty: number; dispatched_qty: number | null; received_qty: number | null; from_location: string; to_location: string; status: string; }
const getShipment = async (q: Queryable, id: string) => (await q.query<ShipmentRow>('SELECT * FROM shipments WHERE shipment_id = $1', [id])).rows[0];

export interface CreateShipmentInput { partId: string; location: string; qty: number; month: string; note: string; }

/** `fixedId` is used only by the seed script, so seeded shipments keep the dashboard's identifiers. */
export async function createShipment(db: Db, ledger: Ledger, user: ApiUser, input: CreateShipmentInput, fixedId?: string): Promise<{ id: string; txId: string; block?: number }> {
  const { partId, location, qty, month, note } = input;
  if (!allowed(user.role, 'request')) throw new HttpError(403, 'Only a Planner can create a shipment request');
  if (typeof partId !== 'string' || !/^SP-\d{3}$/.test(partId)) throw new HttpError(400, 'Invalid part reference');
  const to = locationId(location);
  if (!to) throw new HttpError(400, 'Invalid destination');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Quantity must be a whole number between 1 and 100,000');
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Forecast month must be in YYYY-MM format');
  if (typeof note !== 'string' || !note.trim() || note.length > 1000) throw new HttpError(400, 'A review note (up to 1,000 characters) is required');

  const id = await db.transaction(async q => {
    if (!(await q.query('SELECT 1 FROM parts WHERE part_id = $1', [partId])).rows.length) throw new HttpError(400, 'Unknown part');
    await q.query('LOCK TABLE shipments IN SHARE ROW EXCLUSIVE MODE');
    if (fixedId) return insert(q, fixedId);
    const year = new Date().getUTCFullYear();
    const last = (await q.query<{ n: number | null }>(`SELECT max(split_part(shipment_id, '-', 3)::int) AS n FROM shipments WHERE shipment_id ~ $1`, [`^SHP-${year}-\\d+$`])).rows[0].n ?? 0;
    return insert(q, `SHP-${year}-${String(last + 1).padStart(4, '0')}`);
  });
  async function insert(q: Queryable, newId: string) {
    await q.query(
      `INSERT INTO shipments (shipment_id, part_id, requested_qty, from_location, to_location, status, requested_by, expected_at, forecast_month, review_note, recommendation_id, created_live)
       VALUES ($1, $2, $3, $4, $5, 'Requested', $6, now() + interval '14 days', $7, $8, $9, TRUE)`,
      [newId, partId, qty, to === 'LOC-CW' ? 'Supplier' : 'Central Warehouse', to, user.id, month, note.trim(), `REC-${partId}-${to!.slice(4)}`]
    );
    return newId;
  }

  let outcome: LedgerOutcome;
  try {
    outcome = await ledger.registerRequest({ shipmentId: id, partId, requestedQty: qty });
  } catch (err) {
    // The request is not valid without its ledger record, so remove it again.
    await db.query('DELETE FROM shipments WHERE shipment_id = $1', [id]);
    throw err;
  }
  await db.transaction(async q => {
    await q.query('INSERT INTO shipment_events (shipment_id, status, time, actor_id, tx_id, note) VALUES ($1, $2, $3, $4, $5, $6)', [id, 'Requested', outcome.timestamp, user.id, recordId(outcome.txId), note.trim()]);
    await insertRecord(q, outcome, 'REQUEST', user);
  });
  return { id, txId: outcome.txId, block: outcome.block };
}

async function insertRecord(q: Queryable, outcome: LedgerOutcome, type: string, user: ApiUser, userName = user.name) {
  const r = outcome.record;
  await q.query(
    `INSERT INTO ledger_records (record_id, tx_id, shipment_id, part_id, type, quantity, org, user_id, user_name, block, status, source, failed_rule, reason, from_status, to_status, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'chaincode', $12, $13, $14, $15, $16)`,
    [recordId(outcome.txId), outcome.txId, r.shipmentId, r.partId, r.status === 'Rejected' ? 'ATTEMPT' : type, r.quantity, orgName(r.org), user.id, userName, outcome.block ?? null, r.status, r.failedRule ?? null, r.reason ?? null, r.fromStatus ?? null, r.toStatus ?? null, outcome.timestamp]
  );
}

async function rejectionAlert(q: Queryable, shipmentId: string, known: boolean, title: string, detail: string, at: string) {
  await q.query(
    `INSERT INTO alerts (alert_id, type, severity, title, detail, shipment_id, at) VALUES ($1, 'Rejected attempt', 'Medium', $2, $3, $4, $5)`,
    [shortId('ALT'), title, `${shipmentId}: ${detail}`, known ? shipmentId : null, at]
  );
}

export interface OperateOptions { adjustInventory?: boolean; }

/**
 * Records a dispatch, in-transit update or receipt.
 * 1. The API checks the user's role (application layer). A failure is recorded off-chain only.
 * 2. The operation is submitted to the ledger as the user's peer organization; the chaincode applies the five rules.
 * 3. The reporting copy in PostgreSQL is updated from the ledger outcome.
 */
export async function operate(db: Db, ledger: Ledger, user: ApiUser, operation: LedgerOperation, shipmentId: string, qty: number, note: string, options: OperateOptions = {}): Promise<LedgerResult> {
  if (!['dispatch', 'transit', 'receive'].includes(operation)) throw new HttpError(404, 'Unknown operation');
  if (typeof shipmentId !== 'string' || !shipmentId || shipmentId.length > 64) throw new HttpError(400, 'Invalid shipment reference');
  const quantity = operation === 'transit' ? 0 : Number(qty);
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
  const shipment = await getShipment(db, shipmentId);

  const appFailure = !allowed(user.role, operation)
    ? `The ${user.role} role cannot record a ${ACTION_LABEL[operation]}`
    : !user.mspId ? `${user.org} is not a member organization of the ledger` : null;
  if (appFailure) {
    const id = shortId('TX-REJ');
    const at = new Date().toISOString();
    await db.transaction(async q => {
      await q.query(
        `INSERT INTO ledger_records (record_id, tx_id, shipment_id, part_id, type, quantity, org, user_id, user_name, status, source, failed_rule, reason, from_status, timestamp)
         VALUES ($1, NULL, $2, $3, 'ATTEMPT', $4, $5, $6, $7, 'Rejected', 'application', 'authorizedOrg', $8, $9, $10)`,
        [id, shipmentId, shipment?.part_id ?? 'N/A', quantity, user.org, user.id, user.name, appFailure, shipment?.status ?? null, at]
      );
      await rejectionAlert(q, shipmentId, !!shipment, 'Operation rejected', appFailure, at);
    });
    return { passed: false, failure: 'Authorized organization', failedRule: 'authorizedOrg', reason: appFailure, source: 'application', transactionId: id };
  }

  const outcome = await ledger.submit({ operation, shipmentId, qty: quantity, org: user.mspId as OrgMsp });
  await recordOutcome(db, user, operation, outcome, cleanNote, shipment, options);
  return toResult(outcome);
}

async function recordOutcome(db: Db, user: ApiUser, operation: LedgerOperation, outcome: LedgerOutcome, note: string, shipment: ShipmentRow | undefined, options: OperateOptions, userName?: string, alertTitle = 'Operation rejected') {
  const id = recordId(outcome.txId);
  await db.transaction(async q => {
    await insertRecord(q, outcome, TX_TYPE[operation], user, userName);
    if (!outcome.passed) {
      await rejectionAlert(q, outcome.record.shipmentId, !!shipment, alertTitle, `${outcome.failure} — ${outcome.reason}`, outcome.timestamp);
      return;
    }
    if (!shipment) return; // on the ledger but missing from the reporting copy: shown by verify
    const after = outcome.shipment!;
    await q.query('UPDATE shipments SET status = $2, dispatched_qty = $3, received_qty = $4 WHERE shipment_id = $1', [shipment.shipment_id, after.status, after.dispatchedQty ?? null, after.receivedQty ?? null]);
    await q.query('INSERT INTO shipment_events (shipment_id, status, time, actor_id, tx_id, note) VALUES ($1, $2, $3, $4, $5, $6)', [shipment.shipment_id, after.status, outcome.timestamp, user.id, id, note || null]);
    if (options.adjustInventory !== false) {
      const from = locationId(shipment.from_location);
      if (operation === 'dispatch' && from) await q.query('UPDATE inventory SET on_hand = GREATEST(0, on_hand - $3), updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, from, after.dispatchedQty]);
      if (operation === 'receive') await q.query('UPDATE inventory SET on_hand = on_hand + $3, updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, shipment.to_location, after.receivedQty]);
    }
    if (operation === 'receive' && after.receivedQty !== after.dispatchedQty) {
      await q.query(
        `INSERT INTO alerts (alert_id, type, severity, title, detail, part_id, shipment_id, at) VALUES ($1, 'Discrepancy', 'High', 'Receipt quantity mismatch', $2, $3, $4, $5)`,
        [shortId('ALT'), `${shipment.shipment_id}: dispatched ${after.dispatchedQty}, received ${after.receivedQty}`, shipment.part_id, shipment.shipment_id, outcome.timestamp]
      );
    }
  });
}

const toResult = (o: LedgerOutcome): LedgerResult => ({
  passed: o.passed, failure: o.failure, failedRule: o.failedRule, reason: o.reason,
  source: 'chaincode', transactionId: recordId(o.txId), txId: o.txId, block: o.block
});

export const DEMO_SCENARIOS = ['Duplicate receipt', 'Unauthorized organization', 'Invalid status transition', 'Quantity exceeds dispatched', 'Unknown shipment reference'] as const;

/**
 * Runs one of the rejected-operation demonstrations directly against the chaincode, so the
 * rejection comes from the smart contract (not from the API's role check). The operation is
 * checked first and is only submitted when the chaincode is certain to reject it.
 */
export async function invalidDemo(db: Db, ledger: Ledger, user: ApiUser, scenario: string, preferred?: string): Promise<LedgerResult> {
  if (!DEMO_SCENARIOS.includes(scenario as typeof DEMO_SCENARIOS[number])) throw new HttpError(400, 'Unknown demonstration scenario');
  const pick = async (status: string) => {
    if (preferred) { const s = await getShipment(db, preferred); if (s && s.status === status) return s; }
    return (await db.query<ShipmentRow>('SELECT * FROM shipments WHERE status = $1 ORDER BY shipment_id LIMIT 1', [status])).rows[0];
  };
  let operation: LedgerOperation = 'receive'; let org: OrgMsp = 'Org2MSP'; let target: ShipmentRow | undefined; let shipmentId = 'SHP-UNKNOWN-9999'; let qty = 1;
  if (scenario === 'Duplicate receipt') { target = await pick('Received'); qty = target?.received_qty || 1; }
  if (scenario === 'Unauthorized organization') { operation = 'dispatch'; target = await pick('Requested'); qty = target?.requested_qty ?? 1; }
  if (scenario === 'Invalid status transition') { operation = 'dispatch'; org = 'Org1MSP'; target = await pick('Received'); qty = 1; }
  if (scenario === 'Quantity exceeds dispatched') { target = await pick('In Transit') ?? await pick('Dispatched'); qty = (target?.dispatched_qty ?? 0) + 12; }
  if (scenario !== 'Unknown shipment reference') {
    if (!target) throw new HttpError(409, `No shipment is in a suitable state for the "${scenario}" demonstration`);
    shipmentId = target.shipment_id;
  }
  const check = checkRules(operation, await ledger.read(shipmentId), qty, org);
  if (check.passed) throw new HttpError(409, `The ledger state of ${shipmentId} does not allow the "${scenario}" demonstration`);
  const outcome = await ledger.submit({ operation, shipmentId, qty, org });
  await recordOutcome(db, user, operation, outcome, '', target, {}, `Demo validation tool (${user.name})`, `Rejected · ${scenario}`);
  return toResult(outcome);
}

export async function verifyShipment(db: Db, ledger: Ledger, shipmentId: string) {
  const row = await getShipment(db, shipmentId);
  if (!row) throw new HttpError(404, 'Shipment not found');
  const onChain = await ledger.read(shipmentId);
  if (!onChain) return { shipmentId, onLedger: false, match: false, differences: ['The shipment has no ledger record'], note: noteFor(ledger) };
  const differences: string[] = [];
  const compare = (label: string, db: unknown, chain: unknown) => { if ((db ?? null) !== (chain ?? null)) differences.push(`${label}: database ${db ?? '—'}, ledger ${chain ?? '—'}`); };
  compare('Part', row.part_id, onChain.partId);
  compare('Requested quantity', row.requested_qty, onChain.requestedQty);
  compare('Status', row.status, onChain.status);
  compare('Dispatched quantity', row.dispatched_qty, onChain.dispatchedQty);
  compare('Received quantity', row.received_qty, onChain.receivedQty);
  return { shipmentId, onLedger: true, match: differences.length === 0, differences, note: noteFor(ledger), ledger: onChain as unknown as Record<string, unknown>, history: await ledger.history(shipmentId) };
}

const noteFor = (ledger: Ledger) => ledger.kind === 'local' ? 'Compared with the local development ledger (Fabric is not connected).' : 'Compared with the Hyperledger Fabric world state.';
