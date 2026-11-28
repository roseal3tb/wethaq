import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Db, Queryable } from '../db.js';
import { applyOperation, checkRules, compareShipment, NEXT_STATUS, recordQuantity, type LedgerRecord, type LedgerShipment } from '../../../chaincode/shipment/src/rules.js';
import type { Ledger, LedgerCommitEvent, LedgerOutcome, PreparedTransaction } from './types.js';

const EVENT_NAME = (record: LedgerRecord) => record.operation === 'request' ? 'ShipmentRegistered' : record.status === 'Rejected' ? 'OperationRejected' : 'ShipmentUpdated';

/**
 * Local development ledger (LEDGER_MODE=local).
 * It applies the same chaincode rules and keeps an append-only list of transactions in PostgreSQL,
 * so the API can be developed and tested without Docker or Fabric. It has no endorsement,
 * ordering, peers or certificates and must never be presented as a Fabric ledger.
 */
export function localLedger(db: Db): Ledger {
  const getState = async (q: Queryable, key: string) => (await q.query<{ value: LedgerShipment }>('SELECT value FROM local_ledger_state WHERE key = $1 FOR UPDATE', [key])).rows[0]?.value ?? null;
  const putState = (q: Queryable, key: string, value: unknown) => q.query('INSERT INTO local_ledger_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
  const commit = async (q: Queryable, record: LedgerRecord) => (await q.query<{ block: number }>('INSERT INTO local_ledger_blocks (tx_id, payload, timestamp) VALUES ($1, $2, $3) RETURNING block', [record.txId, JSON.stringify(record), record.timestamp])).rows[0].block;
  const events = new EventEmitter();
  events.setMaxListeners(0);
  // Emitted after the database transaction commits, mirroring the chaincode events Fabric emits.
  const announce = (outcome: LedgerOutcome) => {
    events.emit('commit', { name: EVENT_NAME(outcome.record), txId: outcome.txId, block: outcome.block, record: outcome.record } satisfies LedgerCommitEvent);
    return outcome;
  };
  const prepared = (txId: string, run: (txId: string, timestamp: string) => Promise<LedgerOutcome>): PreparedTransaction =>
    ({ txId, submit: () => run(txId, new Date().toISOString()).then(announce) });
  const newTxId = () => randomBytes(32).toString('hex');

  const ledger: Ledger = {
    kind: 'local',
    async prepareRegister({ shipmentId, partId, requestedQty }) {
      return prepared(newTxId(), (txId, timestamp) => db.transaction(async q => {
        if (await getState(q, shipmentId)) throw new Error(`Shipment ${shipmentId} already exists on the ledger`);
        if (!Number.isInteger(requestedQty) || requestedQty <= 0) throw new Error('Requested quantity must be a positive whole number');
        const shipment: LedgerShipment = { docType: 'shipment', shipmentId, partId, requestedQty, status: 'Requested', updatedAt: timestamp, lastTxId: txId };
        const record: LedgerRecord = { docType: 'record', txId, shipmentId, partId, operation: 'request', quantity: requestedQty, org: 'Org1MSP', toStatus: 'Requested', status: 'Committed', timestamp };
        await putState(q, shipmentId, shipment);
        const block = await commit(q, record);
        return { passed: true, txId, block, timestamp, record, shipment };
      }));
    },
    async prepareSubmit({ operation, shipmentId, qty, org }) {
      return prepared(newTxId(), (txId, timestamp) => db.transaction(async q => {
        const current = await getState(q, shipmentId);
        const check = checkRules(operation, current, qty, org);
        const record: LedgerRecord = {
          docType: 'record', txId, shipmentId, partId: current?.partId ?? 'N/A', operation,
          quantity: recordQuantity(operation, current, qty), org,
          fromStatus: current?.status, toStatus: check.passed ? NEXT_STATUS[operation] : undefined,
          status: check.passed ? 'Committed' : 'Rejected', failedRule: check.failedRule, reason: check.reason, timestamp
        };
        let shipment = current ?? undefined;
        if (check.passed && current) {
          shipment = applyOperation(current, operation, record.quantity, txId, timestamp);
          await putState(q, shipmentId, shipment);
        }
        const block = await commit(q, record);
        return { passed: check.passed, txId, block, timestamp, record, shipment, failedRule: check.failedRule, failure: check.failure, reason: check.reason };
      }));
    },
    registerRequest: async input => (await ledger.prepareRegister(input)).submit(),
    submit: async input => (await ledger.prepareSubmit(input)).submit(),
    async read(shipmentId) {
      return (await db.query<{ value: LedgerShipment }>('SELECT value FROM local_ledger_state WHERE key = $1', [shipmentId])).rows[0]?.value ?? null;
    },
    async history(shipmentId) {
      return (await db.query<{ payload: LedgerRecord }>("SELECT payload FROM local_ledger_blocks WHERE payload->>'shipmentId' = $1 ORDER BY block", [shipmentId])).rows.map(r => r.payload);
    },
    async readRecord(txId) {
      return (await db.query<{ payload: LedgerRecord }>('SELECT payload FROM local_ledger_blocks WHERE tx_id = $1', [txId])).rows[0]?.payload ?? null;
    },
    async transactionStatus(txId) {
      const row = (await db.query<{ block: number }>('SELECT block FROM local_ledger_blocks WHERE tx_id = $1', [txId])).rows[0];
      return row ? { state: 'valid', code: 'VALID', block: Number(row.block) } : { state: 'not_found' };
    },
    async verify(shipmentId, expected) {
      const shipment = await ledger.read(shipmentId);
      if (!shipment) return { found: false, match: false, differences: ['The shipment has no ledger record'] };
      const differences = compareShipment(expected, shipment);
      return { found: true, match: differences.length === 0, differences, ledger: shipment };
    },
    onCommit(listener, options = {}) {
      let stopped = false;
      const queue: LedgerCommitEvent[] = [];
      let draining = Promise.resolve();
      const enqueue = (e: LedgerCommitEvent) => { queue.push(e); draining = draining.then(async () => { const next = queue.shift(); if (next && !stopped) await listener(next); }).catch(() => undefined); };
      if (options.fromBlock !== undefined) {
        // Replay committed transactions after the checkpoint, then continue with live events.
        void db.query<{ block: number; tx_id: string; payload: LedgerRecord }>('SELECT block, tx_id, payload FROM local_ledger_blocks WHERE block > $1 ORDER BY block', [options.fromBlock])
          .then(({ rows }) => rows.forEach(r => enqueue({ name: EVENT_NAME(r.payload), txId: r.tx_id, block: Number(r.block), record: r.payload })))
          .catch(() => undefined);
      }
      events.on('commit', enqueue);
      return () => { stopped = true; events.off('commit', enqueue); };
    },
    async height() {
      return Number((await db.query<{ h: number }>('SELECT COALESCE(max(block), 0) + 1 AS h FROM local_ledger_blocks')).rows[0].h);
    },
    async health() {
      await db.query('SELECT 1 FROM local_ledger_blocks LIMIT 1');
      return { ok: true, detail: 'Local development ledger in PostgreSQL (not Hyperledger Fabric)' };
    },
    close: async () => { events.removeAllListeners(); }
  };
  return ledger;
}

