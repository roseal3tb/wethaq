import type { Db, Queryable } from '../db.js';
import { LedgerError, type Ledger, type LedgerOperation, type OrgMsp } from '../ledger/types.js';
import { checkRules } from '../../../chaincode/shipment/src/rules.js';
import { allowed, type ApiUser } from '../auth.js';
import { audit } from './audit.js';
import { HttpError, locationId, shortId } from './common.js';
import { raiseAlert } from './inventory.js';
import { executeOperation, replay, type OperationOptions, type OperationResponse } from './operations.js';

/** The response the dashboard's live client expects for a ledger operation (src/api/live.ts, LedgerResult). */
export interface LedgerResult {
  passed: boolean; failure?: string; failedRule?: string; reason?: string;
  source?: 'chaincode' | 'application'; transactionId: string; txId?: string; block?: number;
}

const ACTION_LABEL: Record<LedgerOperation, string> = { dispatch: 'dispatch', transit: 'in-transit update', receive: 'receipt' };

interface ShipmentRow {
  shipment_id: string; part_id: string; requested_qty: number; dispatched_qty: number | null; received_qty: number | null;
  from_location: string; to_location: string; status: string; ledger_state: 'pending' | 'confirmed' | 'failed'; last_tx_id: string | null;
}
const getShipment = async (q: Queryable, id: string) => (await q.query<ShipmentRow>('SELECT * FROM shipments WHERE shipment_id = $1', [id])).rows[0];

/** Per-request details: the Idempotency-Key header and the request id used in the audit log. */
export interface RequestContext { idempotencyKey?: string; requestId?: string; }

export function idempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new HttpError(400, 'Idempotency-Key must be 8 to 128 letters, digits or . _ : -');
  return value;
}

export interface CreateShipmentInput { partId: string; location: string; qty: number; month: string; note: string; }

/**
 * Creates a shipment request and registers it on the ledger. The row is written first with
 * ledger_state 'pending'; it becomes 'confirmed' when the registration commits. If the outcome is
 * unknown the row stays pending (it is never deleted while the transaction might have committed).
 * `fixedId` is used only by the seed script, so seeded shipments keep the dashboard's identifiers.
 */
export async function createShipment(db: Db, ledger: Ledger, user: ApiUser, input: CreateShipmentInput, fixedId?: string, ctx: RequestContext = {}): Promise<OperationResponse> {
  const { partId, location, qty, month, note } = input;
  if (!allowed(user.role, 'request')) throw new HttpError(403, 'Only a Planner can create a shipment request');
  if (typeof partId !== 'string' || !/^SP-\d{3}$/.test(partId)) throw new HttpError(400, 'Invalid part reference');
  const to = locationId(location);
  if (!to) throw new HttpError(400, 'Invalid destination');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Quantity must be a whole number between 1 and 100,000');
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Forecast month must be in YYYY-MM format');
  if (typeof note !== 'string' || !note.trim() || note.length > 1000) throw new HttpError(400, 'A review note (up to 1,000 characters) is required');
  if (ctx.idempotencyKey) {
    const previous = await replay(db, user.id, ctx.idempotencyKey);
    if (previous) return previous;
  }

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
      `INSERT INTO shipments (shipment_id, part_id, requested_qty, from_location, to_location, status, requested_by, expected_at, forecast_month, review_note, recommendation_id, created_live, ledger_state)
       VALUES ($1, $2, $3, $4, $5, 'Requested', $6, now() + interval '14 days', $7, $8, $9, TRUE, 'pending')`,
      [newId, partId, qty, to === 'LOC-CW' ? 'Supplier' : 'Central Warehouse', to, user.id, month, note.trim(), `REC-${partId}-${to!.slice(4)}`]
    );
    return newId;
  }

  return executeOperation(db, { kind: 'request', shipmentId: id, user, org: 'Org1MSP', quantity: qty, note: note.trim(), idempotencyKey: ctx.idempotencyKey, requestId: ctx.requestId },
    () => ledger.prepareRegister({ shipmentId: id, partId, requestedQty: qty }),
    // Certainly not on the ledger: the request is not valid without its ledger record, so remove it again.
    { onDefiniteFailure: async q => { await q.query(`DELETE FROM shipments WHERE shipment_id = $1 AND ledger_state = 'pending'`, [id]); } });
}

export interface OperateOptions { adjustInventory?: boolean; }

/**
 * Records a dispatch, in-transit update or receipt.
 * 1. The API checks the user's role (application layer). A failure is recorded off-chain only.
 * 2. The operation is submitted to the ledger as the user's peer organization; the chaincode applies the five rules.
 * 3. The reporting copy in PostgreSQL is updated from the committed ledger record (services/operations.ts).
 */
export async function operate(db: Db, ledger: Ledger, user: ApiUser, operation: LedgerOperation, shipmentId: string, qty: number, note: string, options: OperateOptions = {}, ctx: RequestContext = {}): Promise<OperationResponse> {
  if (!['dispatch', 'transit', 'receive'].includes(operation)) throw new HttpError(404, 'Unknown operation');
  if (typeof shipmentId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(shipmentId)) throw new HttpError(400, 'Invalid shipment reference');
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
        [id, shipmentId, shipment?.part_id ?? 'N/A', Number.isFinite(quantity) ? Math.trunc(quantity) : 0, user.org, user.id, user.name, appFailure, shipment?.status ?? null, at]
      );
      await raiseAlert(q, { type: 'Rejected attempt', severity: 'Medium', title: 'Operation rejected', detail: `${shipmentId}: ${appFailure}`, shipmentId: shipment ? shipmentId : null, at, dedupeKey: `rejected:${id}` });
    });
    await audit(db, { action: `shipment.${operation}`, outcome: 'denied', userId: user.id, org: user.org, target: shipmentId, requestId: ctx.requestId, detail: { reason: appFailure } });
    return { status: 422, body: { passed: false, failure: 'Authorized organization', failedRule: 'authorizedOrg', reason: appFailure, source: 'application', transactionId: id } };
  }
  if (shipment?.ledger_state === 'pending') throw new HttpError(409, `${shipmentId} is waiting for its ledger registration to be confirmed`);

  const opts: OperationOptions = { adjustInventory: options.adjustInventory };
  return executeOperation(db, { kind: operation, shipmentId, user, org: user.mspId as OrgMsp, quantity, note: cleanNote, options: opts, idempotencyKey: ctx.idempotencyKey, requestId: ctx.requestId },
    () => ledger.prepareSubmit({ operation, shipmentId, qty: quantity, org: user.mspId as OrgMsp }));
}

export const DEMO_SCENARIOS = ['Duplicate receipt', 'Unauthorized organization', 'Invalid status transition', 'Quantity exceeds dispatched', 'Unknown shipment reference'] as const;

/**
 * Runs one of the rejected-operation demonstrations directly against the chaincode, so the
 * rejection comes from the smart contract (not from the API's role check). The operation is
 * checked first and is only submitted when the chaincode is certain to reject it.
 */
export async function invalidDemo(db: Db, ledger: Ledger, user: ApiUser, scenario: string, preferred?: string): Promise<OperationResponse> {
  if (!DEMO_SCENARIOS.includes(scenario as typeof DEMO_SCENARIOS[number])) throw new HttpError(400, 'Unknown demonstration scenario');
  const pick = async (status: string) => {
    if (preferred) { const s = await getShipment(db, preferred); if (s && s.status === status) return s; }
    return (await db.query<ShipmentRow>(`SELECT * FROM shipments WHERE status = $1 AND ledger_state = 'confirmed' ORDER BY shipment_id LIMIT 1`, [status])).rows[0];
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
  return executeOperation(db, {
    kind: 'demo', shipmentId, user, userName: `Demo validation tool (${user.name})`, org, quantity: qty,
    options: { operation, alertTitle: `Rejected · ${scenario}` }
  }, () => ledger.prepareSubmit({ operation, shipmentId, qty, org }));
}

export type VerifyStatus = 'verified' | 'mismatch' | 'not_found' | 'pending' | 'ledger_unavailable' | 'failed';

/**
 * Compares the PostgreSQL copy of a shipment with the ledger. For Fabric the comparison runs in the
 * chaincode (VerifyShipment), so the answer comes from the peer's world state.
 */
export async function verifyShipment(db: Db, ledger: Ledger, shipmentId: string) {
  const row = await getShipment(db, shipmentId);
  if (!row) throw new HttpError(404, 'Shipment not found');
  const checkedAt = new Date().toISOString();
  const base = { shipmentId, lastTxId: row.last_tx_id, ledgerState: row.ledger_state, checkedAt, ledgerKind: ledger.kind, note: noteFor(ledger) };
  const open = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ledger_operations WHERE shipment_id = $1 AND applied_at IS NULL AND state IN ('submitting', 'unknown')`, [shipmentId])).rows[0].n;
  if (row.ledger_state === 'failed') return { ...base, status: 'failed' as VerifyStatus, onLedger: false, match: false, differences: ['The ledger registration of this request was not committed'] };
  if (row.ledger_state === 'pending' || open > 0) return { ...base, status: 'pending' as VerifyStatus, onLedger: false, match: false, differences: ['A ledger transaction for this shipment is waiting for confirmation'] };
  const expected = { partId: row.part_id, requestedQty: row.requested_qty, status: row.status, dispatchedQty: row.dispatched_qty ?? undefined, receivedQty: row.received_qty ?? undefined, ...(row.last_tx_id ? { lastTxId: row.last_tx_id } : {}) };
  try {
    const result = await ledger.verify(shipmentId, expected);
    if (!result.found) return { ...base, status: 'not_found' as VerifyStatus, onLedger: false, match: false, differences: result.differences };
    return {
      ...base, status: (result.match ? 'verified' : 'mismatch') as VerifyStatus, onLedger: true, match: result.match, differences: result.differences,
      ledger: result.ledger as unknown as Record<string, unknown>, history: await ledger.history(shipmentId)
    };
  } catch (err) {
    return { ...base, status: 'ledger_unavailable' as VerifyStatus, onLedger: false, match: false, differences: [], error: err instanceof LedgerError || err instanceof Error ? 'The ledger could not be reached' : String(err) };
  }
}

const noteFor = (ledger: Ledger) => ledger.kind === 'local' ? 'Compared with the local development ledger (not Hyperledger Fabric).' : 'Compared on the peer with the Hyperledger Fabric world state (VerifyShipment).';
