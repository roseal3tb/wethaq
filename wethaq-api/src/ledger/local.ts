import { randomBytes } from 'node:crypto';
import type { Db, Queryable } from '../db.js';
import { applyOperation, checkRules, NEXT_STATUS, type LedgerRecord, type LedgerShipment } from '../../../chaincode/shipment/src/rules.js';
import type { Ledger, LedgerOutcome } from './types.js';

/**
 * Local development ledger (LEDGER_MODE=local).
 * It applies the same chaincode rules and keeps an append-only list of transactions in PostgreSQL,
 * so the API can be developed and tested without Docker or Fabric. It has no endorsement,
 * ordering or peers and must not be presented as a Fabric ledger.
 */
export function localLedger(db: Db): Ledger {
  const getState = async (q: Queryable, key: string) => (await q.query<{ value: LedgerShipment }>('SELECT value FROM local_ledger_state WHERE key = $1 FOR UPDATE', [key])).rows[0]?.value ?? null;
  const putState = (q: Queryable, key: string, value: unknown) => q.query('INSERT INTO local_ledger_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
  const commit = async (q: Queryable, record: LedgerRecord) => (await q.query<{ block: number }>('INSERT INTO local_ledger_blocks (tx_id, payload, timestamp) VALUES ($1, $2, $3) RETURNING block', [record.txId, JSON.stringify(record), record.timestamp])).rows[0].block;
  const newTx = () => ({ txId: randomBytes(32).toString('hex'), timestamp: new Date().toISOString() });

  return {
    kind: 'local',
    registerRequest: ({ shipmentId, partId, requestedQty }) => db.transaction(async q => {
      const { txId, timestamp } = newTx();
      if (await getState(q, shipmentId)) throw new Error(`Shipment ${shipmentId} already exists on the ledger`);
      if (!Number.isInteger(requestedQty) || requestedQty <= 0) throw new Error('Requested quantity must be a positive whole number');
      const shipment: LedgerShipment = { docType: 'shipment', shipmentId, partId, requestedQty, status: 'Requested', updatedAt: timestamp, lastTxId: txId };
      const record: LedgerRecord = { docType: 'record', txId, shipmentId, partId, operation: 'request', quantity: requestedQty, org: 'Org1MSP', toStatus: 'Requested', status: 'Committed', timestamp };
      await putState(q, shipmentId, shipment);
      const block = await commit(q, record);
      return { passed: true, txId, block, timestamp, record, shipment } satisfies LedgerOutcome;
    }),
    submit: ({ operation, shipmentId, qty, org }) => db.transaction(async q => {
      const { txId, timestamp } = newTx();
      const current = await getState(q, shipmentId);
      const check = checkRules(operation, current, qty, org);
      const record: LedgerRecord = {
        docType: 'record', txId, shipmentId, partId: current?.partId ?? 'N/A', operation,
        quantity: operation === 'transit' ? (current?.dispatchedQty ?? 0) : qty, org,
        fromStatus: current?.status, toStatus: check.passed ? NEXT_STATUS[operation] : undefined,
        status: check.passed ? 'Committed' : 'Rejected', failedRule: check.failedRule, reason: check.reason, timestamp
      };
      let shipment = current ?? undefined;
      if (check.passed && current) {
        shipment = applyOperation(current, operation, record.quantity, txId, timestamp);
        await putState(q, shipmentId, shipment);
      }
      const block = await commit(q, record);
      return { passed: check.passed, txId, block, timestamp, record, shipment, failedRule: check.failedRule, failure: check.failure, reason: check.reason } satisfies LedgerOutcome;
    }),
    async read(shipmentId) {
      return (await db.query<{ value: LedgerShipment }>('SELECT value FROM local_ledger_state WHERE key = $1', [shipmentId])).rows[0]?.value ?? null;
    },
    async history(shipmentId) {
      return (await db.query<{ payload: LedgerRecord }>("SELECT payload FROM local_ledger_blocks WHERE payload->>'shipmentId' = $1 ORDER BY block", [shipmentId])).rows.map(r => r.payload);
    },
    close: async () => undefined
  };
}
