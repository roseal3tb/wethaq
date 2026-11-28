/**
 * Synchronization between the ledger and the PostgreSQL reporting copy (Section 4.3.6).
 *
 * Every ledger submission goes through executeOperation:
 *   1. the transaction is prepared, so its ledger transaction id is known before anything is sent;
 *   2. a ledger_operations row is written with that id (state "submitting");
 *   3. the transaction is submitted and the API waits for the commit;
 *   4. the committed record is applied to PostgreSQL by applyRecord, exactly once.
 *
 * Three outcomes are kept apart:
 *   Case A  committed and accepted by the chaincode  -> shipment, events and inventory change (HTTP 200/201)
 *   Case B  committed but rejected by the chaincode  -> the rejected attempt is recorded on the ledger (HTTP 422)
 *   Case C  no confirmed commit (Fabric or application failure):
 *           definite (not endorsed, not submitted, invalidated) -> nothing changes, HTTP 503/409
 *           unknown (submit or commit-status timeout)           -> state "unknown", HTTP 202; the reconciler
 *           and the event consumer later find the real result and apply it.
 *
 * applyRecord is idempotent: the record's primary key is derived from the transaction id, and every
 * side effect (status, events, inventory, alerts) runs in the same database transaction as the record
 * insert, only when that insert happened. The API's own response path, the chaincode event consumer
 * and the reconciler can therefore all see the same transaction without applying it twice.
 */
import { isDatabaseUnavailable, type Db, type Queryable } from '../db.js';
import type { EventBus } from '../events.js';
import { logger } from '../logger.js';
import { LedgerError, type Ledger, type LedgerCommitEvent, type LedgerOperation, type LedgerOutcome, type LedgerRecord, type OrgMsp, type PreparedTransaction } from '../ledger/types.js';
import { RULE_LABELS } from '../../../chaincode/shipment/src/rules.js';
import type { ApiUser } from '../auth.js';
import { audit } from './audit.js';
import { HttpError, locationId, orgName, recordId } from './common.js';
import { checkShortage, raiseAlert, resolveAlert } from './inventory.js';

export type OperationKind = 'request' | 'dispatch' | 'transit' | 'receive' | 'receivePartial' | 'cancel' | 'return' | 'demo';

export interface OperationOptions {
  /** false for seeded history: the seeded baseline inventory already includes those movements. */
  adjustInventory?: boolean;
  /** The ledger operation of a demonstration (kind "demo"). */
  operation?: LedgerOperation;
  /** Title of the alert raised when the chaincode rejects the operation. */
  alertTitle?: string;
}

export interface OperationInput {
  kind: OperationKind;
  shipmentId: string;
  user: ApiUser;
  /** Shown in the ledger view; differs from the user's name for the demonstration tool. */
  userName?: string;
  org: OrgMsp;
  quantity: number;
  note?: string;
  options?: OperationOptions;
  idempotencyKey?: string;
  requestId?: string;
}

/** What the HTTP layer sends back: a status code and a JSON body. Stored for Idempotency-Key replays. */
export interface OperationResponse { status: number; body: Record<string, unknown>; }

interface OperationRow {
  operation_id: string; idempotency_key: string | null; kind: OperationKind; shipment_id: string; user_id: string; user_name: string;
  org: string; quantity: number; note: string | null; options: OperationOptions; state: string; failure: string | null; error: string | null;
  block: number | null; response: OperationResponse | null; attempts: number; created_at: Date | string; updated_at: Date | string; applied_at: Date | string | null;
}

const TX_TYPE: Record<LedgerOperation | 'request', string> = { request: 'REQUEST', dispatch: 'DISPATCH', transit: 'STATUS_CHANGE', receive: 'RECEIPT', receivePartial: 'PARTIAL_RECEIPT', cancel: 'CANCELLATION', return: 'RETURN' };

export const pendingKey = (txId: string) => `pending:${txId}`;

/** The response body for a committed transaction (the dashboard's LedgerResult, or the new shipment for a request). */
export function responseFor(kind: OperationKind, record: LedgerRecord, block: number | undefined): OperationResponse {
  const passed = record.status !== 'Rejected';
  const base = { transactionId: recordId(record.txId), txId: record.txId, block, ledgerState: 'confirmed' };
  if (kind === 'request') return { status: 201, body: { id: record.shipmentId, ...base } };
  return {
    status: passed ? 200 : 422,
    body: {
      passed, source: 'chaincode', ...base,
      ...(passed ? {} : { failure: record.failedRule ? RULE_LABELS[record.failedRule] : 'Rejected', failedRule: record.failedRule, reason: record.reason })
    }
  };
}

const pendingResponse = (op: Pick<OperationRow, 'operation_id' | 'kind' | 'shipment_id'>): OperationResponse => ({
  status: 202,
  body: {
    pending: true, ledgerState: 'pending', operationId: op.operation_id, txId: op.operation_id, transactionId: recordId(op.operation_id),
    ...(op.kind === 'request' ? { id: op.shipment_id } : {}),
    message: 'The ledger has not confirmed this transaction yet. It will be applied automatically once its outcome is known; do not submit it again.'
  }
});

const FAILURE_MESSAGE: Record<string, string> = {
  unavailable: 'The blockchain network is not reachable. Nothing was recorded; try again when it is available.',
  endorsement: 'The blockchain peers did not endorse the transaction. Nothing was recorded.',
  invalid: 'The transaction was ordered but invalidated by the peers (for example a concurrent update). Nothing was recorded; try again.',
  expired: 'The ledger never committed this transaction. Nothing was recorded.'
};
const failureStatus = (category: string) => (category === 'unavailable' ? 503 : category === 'invalid' ? 409 : 502);

/** Looks up an earlier submission with the same Idempotency-Key from the same user. */
export async function replay(db: Db, userId: string, key: string): Promise<OperationResponse | null> {
  const row = (await db.query<OperationRow>('SELECT * FROM ledger_operations WHERE user_id = $1 AND idempotency_key = $2', [userId, key])).rows[0];
  if (!row) return null;
  if (row.response) return row.response;
  return pendingResponse(row);
}

export interface ExecuteHooks {
  /** Runs when the transaction certainly did not commit (used to remove a pending shipment request). */
  onDefiniteFailure?: (q: Queryable, txId: string) => Promise<void>;
}

/**
 * Submits one ledger transaction with durable tracking (see the file comment).
 * Throws HttpError for Case C failures that are certain; returns 202 for unknown outcomes.
 */
export async function executeOperation(db: Db, input: OperationInput, prepare: () => Promise<PreparedTransaction>, hooks: ExecuteHooks = {}): Promise<OperationResponse> {
  const { user } = input;
  if (input.idempotencyKey) {
    const previous = await replay(db, user.id, input.idempotencyKey);
    if (previous) return previous;
  }

  let prepared: PreparedTransaction;
  try {
    prepared = await prepare();
  } catch (err) {
    await hooks.onDefiniteFailure?.(db, '');
    throw await ledgerFailure(db, input, err, undefined);
  }

  try {
    await db.query(
      `INSERT INTO ledger_operations (operation_id, idempotency_key, kind, shipment_id, user_id, user_name, org, quantity, note, options, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitting')`,
      [prepared.txId, input.idempotencyKey ?? null, input.kind, input.shipmentId, user.id, input.userName ?? user.name, input.org, input.quantity, input.note || null, JSON.stringify(input.options ?? {})]);
  } catch (err) {
    // Two requests with the same Idempotency-Key at the same moment: the second one waits for the first.
    if (input.idempotencyKey && /unique|duplicate/i.test(String(err))) {
      const previous = await replay(db, user.id, input.idempotencyKey);
      if (previous) return previous;
    }
    throw err;
  }

  let outcome: LedgerOutcome;
  try {
    outcome = await prepared.submit();
  } catch (err) {
    const category = err instanceof LedgerError ? err.category : 'error';
    if (err instanceof LedgerError && !err.definite) {
      // Case C, unknown: the transaction may still commit. Keep everything pending and let the reconciler decide.
      const response = pendingResponse({ operation_id: prepared.txId, kind: input.kind, shipment_id: input.shipmentId });
      await db.transaction(async q => {
        // Skipped when the event consumer has already applied the commit (it can arrive before the timeout).
        const open = await q.query(`UPDATE ledger_operations SET state = 'unknown', failure = $2, error = $3, updated_at = now() WHERE operation_id = $1 AND applied_at IS NULL RETURNING operation_id`, [prepared.txId, category, err.message]);
        if (!open.rows.length) return;
        await raiseAlert(q, {
          type: 'Pending transaction', severity: 'Medium', title: 'Ledger confirmation pending',
          detail: `${input.shipmentId}: ${input.kind} transaction ${recordId(prepared.txId)} is waiting for the ledger to confirm it`,
          shipmentId: input.shipmentId, at: new Date().toISOString(), dedupeKey: pendingKey(prepared.txId)
        });
      });
      await audit(db, { action: `ledger.${input.kind}`, outcome: 'pending', userId: user.id, org: input.org, target: input.shipmentId, requestId: input.requestId, detail: { txId: prepared.txId, failure: category, message: err.message } });
      logger.warn('ledger_outcome_unknown', { txId: prepared.txId, kind: input.kind, shipmentId: input.shipmentId, failure: category });
      // The commit may already have been applied by the event consumer in the meantime.
      const row = (await db.query<OperationRow>('SELECT response FROM ledger_operations WHERE operation_id = $1', [prepared.txId])).rows[0];
      return row?.response ?? response;
    }
    // Case C, definite: nothing is on the ledger.
    await db.transaction(async q => {
      await q.query(`UPDATE ledger_operations SET state = 'failed', failure = $2, error = $3, updated_at = now() WHERE operation_id = $1`, [prepared.txId, category, err instanceof Error ? err.message : String(err)]);
      await hooks.onDefiniteFailure?.(q, prepared.txId);
    });
    throw await ledgerFailure(db, input, err, prepared.txId);
  }

  try {
    return await applyRecord(db, outcome.record, outcome.block);
  } catch (err) {
    if (!isDatabaseUnavailable(err)) throw err;
    // Committed on the ledger, but PostgreSQL went away before it could be updated. The operation row stays
    // 'submitting'; the event consumer or the reconciler applies the record once PostgreSQL is reachable again.
    logger.error('ledger_apply_deferred', { txId: prepared.txId, kind: input.kind, shipmentId: input.shipmentId, block: outcome.block, error: String(err) });
    return pendingResponse({ operation_id: prepared.txId, kind: input.kind, shipment_id: input.shipmentId });
  }
}

/** Records a certain Case C failure in the audit log and turns it into a safe HTTP error. */
async function ledgerFailure(db: Db, input: OperationInput, err: unknown, txId: string | undefined): Promise<Error> {
  const category = err instanceof LedgerError ? err.category : 'error';
  const message = err instanceof Error ? err.message : String(err);
  await audit(db, { action: `ledger.${input.kind}`, outcome: 'failed', userId: input.user.id, org: input.org, target: input.shipmentId, requestId: input.requestId, detail: { txId, failure: category, message } });
  logger.warn('ledger_submission_failed', { txId, kind: input.kind, shipmentId: input.shipmentId, failure: category, message });
  if (!(err instanceof LedgerError)) {
    // A rule the ledger enforces before writing anything (for example a duplicate shipment id on the local ledger).
    if (err instanceof HttpError) return err;
    return new HttpError(409, `The ledger refused the transaction: ${message}`);
  }
  const detail = category === 'endorsement' && err.message ? ` (${err.message})` : '';
  const out = new HttpError(failureStatus(category), FAILURE_MESSAGE[category] + detail);
  return Object.assign(out, { ledgerFailure: category, txId });
}

/**
 * Applies a committed ledger record to PostgreSQL, once. Returns the response for the operation that
 * submitted it. Safe to call any number of times, from any number of places, for the same transaction.
 */
export async function applyRecord(db: Db, record: LedgerRecord, block: number | undefined): Promise<OperationResponse> {
  return db.transaction(async q => {
    const op = (await q.query<OperationRow>('SELECT * FROM ledger_operations WHERE operation_id = $1 FOR UPDATE', [record.txId])).rows[0];
    const kind: OperationKind = op?.kind ?? (record.operation === 'request' ? 'request' : record.operation);
    const response = responseFor(kind, record, block);
    const inserted = await insertRecord(q, record, block, op);
    if (inserted) await project(q, record, op);
    if (op && !op.applied_at) {
      await q.query(`UPDATE ledger_operations SET state = $2, block = $3, response = $4, applied_at = now(), updated_at = now(), failure = NULL, error = NULL WHERE operation_id = $1`,
        [record.txId, record.status === 'Rejected' ? 'rejected' : 'committed', block ?? null, JSON.stringify(response)]);
      if (op.state === 'unknown') await resolveAlert(q, pendingKey(record.txId), `Confirmed by the ledger in block ${block ?? '—'}`);
    }
    return op?.response ?? response;
  });
}

async function insertRecord(q: Queryable, r: LedgerRecord, block: number | undefined, op: OperationRow | undefined): Promise<boolean> {
  const type = r.status === 'Rejected' ? 'ATTEMPT' : TX_TYPE[r.operation];
  // A transaction from another client of the network has no operation row: it is attributed to its organization.
  const userName = op?.user_name ?? `${orgName(r.org)} (ledger client)`;
  const res = await q.query(
    `INSERT INTO ledger_records (record_id, tx_id, shipment_id, part_id, type, quantity, org, user_id, user_name, block, status, source, failed_rule, reason, from_status, to_status, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'chaincode', $12, $13, $14, $15, $16)
     ON CONFLICT DO NOTHING RETURNING record_id`,
    [recordId(r.txId), r.txId, r.shipmentId, r.partId, type, r.quantity, orgName(r.org), op?.user_id ?? null, userName, block ?? null, r.status, r.failedRule ?? null, r.reason ?? null, r.fromStatus ?? null, r.toStatus ?? null, r.timestamp]);
  return res.rows.length > 0;
}

interface ShipmentRow { shipment_id: string; part_id: string; dispatched_qty: number | null; received_qty: number | null; from_location: string; to_location: string; status: string; }

/** The side effects of a newly inserted record: shipment status, timeline, inventory and alerts. */
async function project(q: Queryable, r: LedgerRecord, op: OperationRow | undefined) {
  const shipment = (await q.query<ShipmentRow>('SELECT * FROM shipments WHERE shipment_id = $1 FOR UPDATE', [r.shipmentId])).rows[0];
  const actor = op?.user_id ?? null;
  const note = op?.note ?? null;
  const options = op?.options ?? {};
  const id = recordId(r.txId);

  if (r.status === 'Rejected') {
    const title = options.alertTitle ?? 'Operation rejected';
    await raiseAlert(q, {
      type: 'Rejected attempt', severity: 'Medium', title, detail: `${r.shipmentId}: ${r.failedRule ? RULE_LABELS[r.failedRule] : 'Rejected'} — ${r.reason ?? ''}`.trim(),
      shipmentId: shipment ? r.shipmentId : null, at: r.timestamp, dedupeKey: `rejected:${r.txId}`
    });
    return;
  }
  if (!shipment) {
    // On the ledger but missing from the reporting copy (for example created by another client): shown by verify.
    logger.warn('ledger_record_without_shipment', { txId: r.txId, shipmentId: r.shipmentId, operation: r.operation });
    return;
  }

  if (r.operation === 'request') {
    await q.query(`UPDATE shipments SET ledger_state = 'confirmed', last_tx_id = $2 WHERE shipment_id = $1`, [r.shipmentId, r.txId]);
    await q.query('INSERT INTO shipment_events (shipment_id, status, time, actor_id, tx_id, note) VALUES ($1, $2, $3, $4, $5, $6)', [r.shipmentId, 'Requested', r.timestamp, actor, id, note]);
    return;
  }

  const receipt = r.operation === 'receive' || r.operation === 'receivePartial';
  const dispatched = r.operation === 'dispatch' ? r.quantity : shipment.dispatched_qty;
  // Received quantities add up across partial receipts and the final receipt (chaincode version 2).
  const received = receipt ? (shipment.received_qty ?? 0) + r.quantity : null;
  const returned = r.operation === 'return' ? r.quantity : null;
  await q.query(
    `UPDATE shipments SET status = $2, dispatched_qty = $3, received_qty = COALESCE($4, received_qty), returned_qty = COALESCE($5, returned_qty), last_tx_id = $6, ledger_state = 'confirmed' WHERE shipment_id = $1`,
    [r.shipmentId, r.toStatus, dispatched, received, returned, r.txId]);
  await q.query('INSERT INTO shipment_events (shipment_id, status, time, actor_id, tx_id, note) VALUES ($1, $2, $3, $4, $5, $6)', [r.shipmentId, r.toStatus, r.timestamp, actor, id, note]);

  if (options.adjustInventory !== false) {
    const from = locationId(shipment.from_location);
    if (r.operation === 'dispatch' && from) {
      await q.query('UPDATE inventory SET on_hand = GREATEST(0, on_hand - $3), updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, from, r.quantity]);
      await checkShortage(q, shipment.part_id, from, r.timestamp);
    }
    if (receipt) {
      await q.query('UPDATE inventory SET on_hand = on_hand + $3, updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, shipment.to_location, r.quantity]);
      await checkShortage(q, shipment.part_id, shipment.to_location, r.timestamp);
    }
    // A cancelled dispatch puts the stock back where it left; a return moves it from the destination back to the origin.
    if (r.operation === 'cancel' && r.fromStatus === 'Dispatched' && from && r.quantity > 0) {
      await q.query('UPDATE inventory SET on_hand = on_hand + $3, updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, from, r.quantity]);
    }
    if (r.operation === 'return') {
      await q.query('UPDATE inventory SET on_hand = GREATEST(0, on_hand - $3), updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, shipment.to_location, r.quantity]);
      await checkShortage(q, shipment.part_id, shipment.to_location, r.timestamp);
      if (from) await q.query('UPDATE inventory SET on_hand = on_hand + $3, updated_at = now() WHERE part_id = $1 AND location_id = $2', [shipment.part_id, from, r.quantity]);
    }
  }
  if (r.operation === 'receive' && received !== dispatched) {
    await raiseAlert(q, {
      type: 'Discrepancy', severity: 'High', title: 'Receipt quantity mismatch',
      detail: `${r.shipmentId}: dispatched ${dispatched}, received ${received}`, partId: shipment.part_id, shipmentId: r.shipmentId,
      at: r.timestamp, dedupeKey: `discrepancy:${r.shipmentId}`
    });
  }
}

// ---------------------------------------------------------------------------------------------------
// Event consumer and reconciler
// ---------------------------------------------------------------------------------------------------

export const CHECKPOINT = 'ledger-events';

export interface SyncStatus {
  ledger: 'local' | 'fabric';
  checkpoint: { block: number; txId: string | null; updatedAt: string } | null;
  operations: Record<string, number>;
  open: { operationId: string; kind: string; shipmentId: string; state: string; failure: string | null; attempts: number; createdAt: string }[];
  lastReconcile: ReconcileReport | null;
  consumer: { running: boolean; lastEventAt: string | null; lastError: string | null; checkpointReset: CheckpointReset | null };
}

/** Set when the stored checkpoint was found ahead of the ledger at startup (see checkpointBehindLedger). */
export interface CheckpointReset { at: string; fromBlock: number; toBlock: number; ledgerHeight: number; reason: string; }

/**
 * Checks, once at startup, that the ledger still contains the last block PostgreSQL applied. After the ledger is
 * restored from an older backup (or replaced by a new network), the stored checkpoint can point past the end of the
 * ledger: the consumer would then wait for a block number that is reused by new transactions and miss them. In that
 * case the checkpoint is moved to the current end of the ledger, so new transactions are applied, and a critical
 * alert asks an administrator to run the consistency check. Nothing else is changed: PostgreSQL may now hold
 * transactions the ledger does not have, and deciding what to do about them is left to the administrator.
 */
async function checkpointBehindLedger(db: Db, ledger: Ledger, checkpoint: { block: number; tx_id: string | null }): Promise<CheckpointReset | null> {
  let height: number;
  try { height = await ledger.height(); } catch (err) {
    logger.warn('ledger_checkpoint_check_skipped', { error: String(err) });
    return null;
  }
  const block = Number(checkpoint.block);
  let reason: string | null = null;
  if (block >= height) reason = `the last applied block ${block} is beyond the ledger height ${height}`;
  else if (checkpoint.tx_id) {
    const status = await ledger.transactionStatus(checkpoint.tx_id).catch(() => null);
    if (status && status.state === 'not_found') reason = `the last applied transaction ${checkpoint.tx_id.slice(0, 12)} is not on the ledger`;
  }
  if (!reason) return null;
  const reset: CheckpointReset = { at: new Date().toISOString(), fromBlock: block, toBlock: Math.max(0, height - 1), ledgerHeight: height, reason };
  await db.transaction(async q => {
    await q.query('UPDATE event_checkpoints SET block = $2, tx_id = NULL, updated_at = now() WHERE name = $1', [CHECKPOINT, reset.toBlock]);
    await raiseAlert(q, {
      type: 'Ledger sync', severity: 'Critical', title: 'The ledger is behind the database',
      detail: `PostgreSQL has applied ledger transactions that the ledger does not contain (${reason}). The ledger may have been restored from an older backup or replaced. New transactions are followed from block ${height}. Run the consistency check (Admin, GET /api/admin/consistency) before relying on the reporting copy.`,
      at: reset.at, dedupeKey: 'ledger-sync:checkpoint-ahead'
    });
  });
  await audit(db, { action: 'ledger.checkpoint_reset', outcome: 'ok', detail: { ...reset } });
  logger.error('ledger_checkpoint_ahead', { ...reset });
  return reset;
}

export interface ReconcileReport { at: string; checked: number; applied: number; failed: number; stillPending: number; errors: string[]; }

/**
 * Keeps PostgreSQL in step with the ledger while the API runs:
 *  - consumes chaincode events from the stored checkpoint (all clients' transactions, in block order);
 *  - reconciles operations whose outcome is unknown, or that were interrupted by a restart.
 */
export function startSync({ db, ledger, bus, intervalMs, pendingExpiryMs, submittingGraceMs = 120_000, resyncDelayMs = 5_000 }: { db: Db; ledger: Ledger; bus?: EventBus; intervalMs: number; pendingExpiryMs: number; submittingGraceMs?: number; resyncDelayMs?: number }) {
  const consumer = { running: true, lastEventAt: null as string | null, lastError: null as string | null, checkpointReset: null as CheckpointReset | null };
  let checkedCheckpoint = false;
  let lastReconcile: ReconcileReport | null = null;
  let stopEvents: (() => void) | undefined;
  let stopped = false;
  // Each subscription has a generation. When an event cannot be applied (for example PostgreSQL is down), the
  // subscription is dropped, later events of it are ignored so the checkpoint does not move past the failed one,
  // and the consumer subscribes again from the stored checkpoint after a delay. Applying is idempotent.
  let generation = 0;
  let resyncTimer: ReturnType<typeof setTimeout> | undefined;

  const subscribe = async () => {
    // No checkpoint yet (a new database): follow new events only. Earlier transactions were applied when
    // they were submitted, or are found by verify and the reconciler.
    let checkpoint = (await db.query<{ block: number; tx_id: string | null }>('SELECT block, tx_id FROM event_checkpoints WHERE name = $1', [CHECKPOINT])).rows[0];
    if (checkpoint && !checkedCheckpoint) {
      checkedCheckpoint = true;
      const reset = await checkpointBehindLedger(db, ledger, checkpoint);
      if (reset) { consumer.checkpointReset = reset; checkpoint = { block: reset.toBlock, tx_id: null }; }
    }
    if (stopped) return;
    const mine = ++generation;
    stopEvents = ledger.onCommit(e => (mine === generation ? onEvent(e, mine) : Promise.resolve()), checkpoint ? { fromBlock: Number(checkpoint.block) } : {});
  };
  const scheduleResync = () => {
    generation++;
    stopEvents?.(); stopEvents = undefined;
    if (stopped || resyncTimer) return;
    resyncTimer = setTimeout(() => {
      resyncTimer = undefined;
      subscribe().catch(err => { consumer.lastError = String(err); scheduleResync(); });
    }, resyncDelayMs);
    resyncTimer.unref?.();
  };

  const onEvent = async (e: LedgerCommitEvent, mine: number) => {
    if (mine !== generation) return;
    try {
      await applyRecord(db, e.record, e.block);
      if (e.block !== undefined) {
        await db.query(`INSERT INTO event_checkpoints (name, block, tx_id) VALUES ($1, $2, $3)
          ON CONFLICT (name) DO UPDATE SET block = GREATEST(event_checkpoints.block, EXCLUDED.block), tx_id = EXCLUDED.tx_id, updated_at = now()`, [CHECKPOINT, e.block, e.txId]);
      }
      consumer.lastEventAt = new Date().toISOString(); consumer.lastError = null;
      bus?.emit({ kind: 'ledger', name: e.name, txId: e.txId, block: e.block, shipmentId: e.record.shipmentId, status: e.record.status === 'Rejected' ? 'Rejected' : e.record.toStatus, operation: e.record.operation });
    } catch (err) {
      consumer.lastError = String(err);
      logger.error('ledger_event_apply_failed', { txId: e.txId, block: e.block, error: String(err), resyncInMs: resyncDelayMs });
      if (mine === generation) scheduleResync();
    }
  };

  const ready = subscribe().catch(err => { consumer.lastError = String(err); logger.error('ledger_events_subscribe_failed', { error: String(err) }); scheduleResync(); });

  const reconcileNow = async () => {
    lastReconcile = await reconcile(db, ledger, { pendingExpiryMs, submittingGraceMs });
    if (lastReconcile.applied || lastReconcile.failed) bus?.emit({ kind: 'app', name: 'LedgerReconciled' });
    return lastReconcile;
  };
  let running: Promise<unknown> = Promise.resolve();
  const timer = intervalMs > 0 ? setInterval(() => { running = reconcileNow().catch(err => logger.error('reconcile_failed', { error: String(err) })); }, intervalMs) : undefined;
  timer?.unref?.();
  // On startup: pick up operations that a previous process left unfinished.
  if (intervalMs > 0) running = reconcileNow().catch(err => logger.error('reconcile_failed', { error: String(err) }));

  return {
    ready,
    reconcile: reconcileNow,
    async status(): Promise<SyncStatus> {
      const [cp, counts, open] = await Promise.all([
        db.query<Record<string, any>>('SELECT block, tx_id, updated_at FROM event_checkpoints WHERE name = $1', [CHECKPOINT]),
        db.query<{ state: string; n: number }>('SELECT state, count(*)::int AS n FROM ledger_operations GROUP BY state'),
        db.query<OperationRow>(`SELECT * FROM ledger_operations WHERE applied_at IS NULL AND state IN ('submitting', 'unknown') ORDER BY created_at LIMIT 100`)
      ]);
      const c = cp.rows[0];
      return {
        ledger: ledger.kind,
        checkpoint: c ? { block: Number(c.block), txId: c.tx_id, updatedAt: new Date(c.updated_at).toISOString() } : null,
        operations: Object.fromEntries(counts.rows.map(r => [r.state, Number(r.n)])),
        open: open.rows.map(o => ({ operationId: o.operation_id, kind: o.kind, shipmentId: o.shipment_id, state: o.state, failure: o.failure, attempts: o.attempts, createdAt: new Date(o.created_at).toISOString() })),
        lastReconcile, consumer: { ...consumer, running: consumer.running && !stopped }
      };
    },
    async stop() {
      stopped = true; consumer.running = false;
      if (timer) clearInterval(timer);
      if (resyncTimer) clearTimeout(resyncTimer);
      await ready.catch(() => undefined);
      stopEvents?.();
      await running.catch(() => undefined);
    }
  };
}
export type SyncService = ReturnType<typeof startSync>;

/**
 * Finds the outcome of every operation that is not applied yet: unknown outcomes, and submissions that
 * a crash interrupted. Valid transactions are applied; invalid ones and ones the ledger never received
 * (after pendingExpiryMs) are marked failed. Nothing is decided while the ledger cannot be reached.
 */
export async function reconcile(db: Db, ledger: Ledger, { pendingExpiryMs, submittingGraceMs = 120_000, now = Date.now() }: { pendingExpiryMs: number; submittingGraceMs?: number; now?: number }): Promise<ReconcileReport> {
  const report: ReconcileReport = { at: new Date(now).toISOString(), checked: 0, applied: 0, failed: 0, stillPending: 0, errors: [] };
  const rows = (await db.query<OperationRow>(`SELECT * FROM ledger_operations WHERE applied_at IS NULL AND state IN ('submitting', 'unknown') ORDER BY created_at LIMIT 200`)).rows;
  for (const op of rows) {
    const age = now - new Date(op.created_at).getTime();
    // A submission still in progress in this process: leave it to the request that is waiting for it.
    if (op.state === 'submitting' && age < submittingGraceMs) continue;
    report.checked++;
    try {
      const status = await ledger.transactionStatus(op.operation_id);
      if (status.state === 'valid') {
        const record = await ledger.readRecord(op.operation_id);
        if (record) { await applyRecord(db, record, status.block); report.applied++; continue; }
        await markFailed(db, op, 'invalid', `Transaction ${op.operation_id} is valid on the ledger but wrote no record`);
        report.failed++; continue;
      }
      if (status.state === 'invalid') { await markFailed(db, op, 'invalid', `Invalidated by the peers (${status.code ?? 'unknown code'})`); report.failed++; continue; }
      if (age >= pendingExpiryMs) { await markFailed(db, op, 'expired', `Not on the ledger ${Math.round(age / 1000)} s after submission`); report.failed++; continue; }
      await db.query('UPDATE ledger_operations SET attempts = attempts + 1, updated_at = now() WHERE operation_id = $1', [op.operation_id]);
      report.stillPending++;
    } catch (err) {
      // The ledger is not reachable: keep the operation pending and raise one sync alert.
      report.errors.push(`${op.operation_id}: ${String(err)}`);
      report.stillPending++;
      await db.query('UPDATE ledger_operations SET attempts = attempts + 1, updated_at = now() WHERE operation_id = $1', [op.operation_id]);
      await raiseAlert(db, { type: 'Ledger sync', severity: 'High', title: 'Ledger not reachable for reconciliation', detail: `Pending transactions cannot be confirmed: ${String(err).slice(0, 200)}`, at: new Date(now).toISOString(), dedupeKey: 'ledger-sync:unreachable' });
    }
  }
  if (!report.errors.length) await resolveAlert(db, 'ledger-sync:unreachable', 'The ledger is reachable again');
  if (report.checked) logger.info('reconcile', { ...report, errors: report.errors.length });
  return report;
}

async function markFailed(db: Db, op: OperationRow, failure: string, message: string) {
  const response: OperationResponse = { status: failureStatus(failure), body: { error: FAILURE_MESSAGE[failure] ?? message, ledgerState: 'failed', txId: op.operation_id } };
  await db.transaction(async q => {
    await q.query(`UPDATE ledger_operations SET state = 'failed', failure = $2, error = $3, response = $4, updated_at = now() WHERE operation_id = $1 AND applied_at IS NULL`, [op.operation_id, failure, message, JSON.stringify(response)]);
    // A request that never reached the ledger stays visible, marked failed, so the planner can see and redo it.
    if (op.kind === 'request') await q.query(`UPDATE shipments SET ledger_state = 'failed' WHERE shipment_id = $1 AND ledger_state = 'pending'`, [op.shipment_id]);
    await resolveAlert(q, pendingKey(op.operation_id), `Not committed: ${message}`);
    await raiseAlert(q, {
      type: 'Ledger sync', severity: 'High', title: 'Ledger transaction not committed',
      detail: `${op.shipment_id}: ${op.kind} transaction ${recordId(op.operation_id)} was not committed (${message}). Nothing was changed.`,
      shipmentId: op.shipment_id, at: new Date().toISOString(), dedupeKey: `failed:${op.operation_id}`
    });
  });
  await audit(db, { action: `ledger.${op.kind}`, outcome: 'failed', userId: op.user_id, org: op.org, target: op.shipment_id, detail: { txId: op.operation_id, failure, message, by: 'reconciler' } });
}
