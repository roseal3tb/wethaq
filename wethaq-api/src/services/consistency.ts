/**
 * Consistency check between the PostgreSQL reporting copy and the ledger (GET /api/admin/consistency).
 *
 * For every shipment it compares the PostgreSQL row with the ledger's world state (VerifyShipment on the peer)
 * and the set of chaincode transactions PostgreSQL holds for it with the shipment's ledger history. It also checks
 * the event checkpoint against the ledger height. It only reads: nothing is changed on either side, because which
 * side is right after, for example, restoring the ledger from an older backup is a decision for an operator
 * (docs/gp482/BACKUP_AND_RECOVERY.md).
 */
import type { Queryable } from '../db.js';
import type { Db } from '../db.js';
import type { Ledger } from '../ledger/types.js';
import { CHECKPOINT } from './operations.js';
import { verifyShipment } from './shipments.js';

export interface ShipmentConsistency {
  shipmentId: string;
  status: string;
  differences: string[];
  /** Chaincode transactions recorded in PostgreSQL that the ledger history does not contain. */
  missingOnLedger: string[];
  /** Ledger transactions for the shipment that PostgreSQL has no record of. */
  missingInDatabase: string[];
}

export interface ConsistencyReport {
  checkedAt: string;
  ledger: 'local' | 'fabric';
  ledgerHeight: number | null;
  checkpoint: { block: number; txId: string | null; aheadOfLedger: boolean } | null;
  consistent: boolean;
  summary: { shipments: number; verified: number; mismatch: number; notFound: number; pending: number; failed: number; unavailable: number; recordsMissingOnLedger: number; recordsMissingInDatabase: number; orphanRecordsChecked: number; orphanRecordsMissingOnLedger: number };
  problems: ShipmentConsistency[];
  orphanRecordsMissingOnLedger: string[];
  truncated: boolean;
}

const LIMIT = 2000;

export async function consistencyReport(db: Db, ledger: Ledger, { concurrency = 8 }: { concurrency?: number } = {}): Promise<ConsistencyReport> {
  const checkedAt = new Date().toISOString();
  const ledgerHeight = await ledger.height().catch(() => null);
  const cp = (await db.query<{ block: number; tx_id: string | null }>('SELECT block, tx_id FROM event_checkpoints WHERE name = $1', [CHECKPOINT])).rows[0];
  const checkpoint = cp ? { block: Number(cp.block), txId: cp.tx_id, aheadOfLedger: ledgerHeight !== null && Number(cp.block) >= ledgerHeight } : null;

  const ids = (await db.query<{ shipment_id: string }>('SELECT shipment_id FROM shipments ORDER BY shipment_id LIMIT $1', [LIMIT + 1])).rows.map(r => r.shipment_id);
  const truncated = ids.length > LIMIT;
  const summary = { shipments: Math.min(ids.length, LIMIT), verified: 0, mismatch: 0, notFound: 0, pending: 0, failed: 0, unavailable: 0, recordsMissingOnLedger: 0, recordsMissingInDatabase: 0, orphanRecordsChecked: 0, orphanRecordsMissingOnLedger: 0 };
  const problems: ShipmentConsistency[] = [];

  const checkOne = async (id: string) => {
    const v = await verifyShipment(db, ledger, id);
    const counted = { verified: 'verified', mismatch: 'mismatch', not_found: 'notFound', pending: 'pending', failed: 'failed', ledger_unavailable: 'unavailable' } as const;
    summary[counted[v.status]]++;
    let missingOnLedger: string[] = [];
    let missingInDatabase: string[] = [];
    if (v.status === 'verified' || v.status === 'mismatch' || v.status === 'not_found') {
      const inDb = await chaincodeTxIds(db, id);
      const onLedger = new Set(((v as { history?: { txId: string }[] }).history ?? []).map(h => h.txId));
      missingOnLedger = [...inDb].filter(tx => !onLedger.has(tx));
      missingInDatabase = [...onLedger].filter(tx => !inDb.has(tx));
    }
    summary.recordsMissingOnLedger += missingOnLedger.length;
    summary.recordsMissingInDatabase += missingInDatabase.length;
    // A failed request (never registered) or one still pending is reported but is not an inconsistency by itself.
    if (v.status !== 'verified' || missingOnLedger.length || missingInDatabase.length) {
      problems.push({ shipmentId: id, status: v.status, differences: v.differences, missingOnLedger, missingInDatabase });
    }
  };
  const list = ids.slice(0, LIMIT);
  for (let i = 0; i < list.length; i += concurrency) await Promise.all(list.slice(i, i + concurrency).map(checkOne));

  // Rejected attempts and records for shipment ids that are not in the shipments table (for example an attempt
  // on an unknown shipment, or a transaction from another client of the network): each must exist on the ledger.
  const orphans = (await db.query<{ tx_id: string }>(`SELECT tx_id FROM ledger_records r WHERE source = 'chaincode' AND tx_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.shipment_id = r.shipment_id) ORDER BY timestamp LIMIT 500`)).rows;
  const orphanRecordsMissingOnLedger: string[] = [];
  for (let i = 0; i < orphans.length; i += concurrency) {
    await Promise.all(orphans.slice(i, i + concurrency).map(async o => {
      const status = await ledger.transactionStatus(o.tx_id).catch(() => null);
      if (status === null) { summary.unavailable++; return; }
      summary.orphanRecordsChecked++;
      if (status.state !== 'valid') orphanRecordsMissingOnLedger.push(o.tx_id);
    }));
  }
  summary.orphanRecordsMissingOnLedger = orphanRecordsMissingOnLedger.length;

  const consistent = !checkpoint?.aheadOfLedger && ledgerHeight !== null && summary.mismatch === 0 && summary.notFound === 0 && summary.unavailable === 0
    && summary.recordsMissingOnLedger === 0 && summary.recordsMissingInDatabase === 0 && summary.orphanRecordsMissingOnLedger === 0;
  return { checkedAt, ledger: ledger.kind, ledgerHeight, checkpoint, consistent, summary, problems, orphanRecordsMissingOnLedger, truncated };
}

async function chaincodeTxIds(q: Queryable, shipmentId: string) {
  const rows = (await q.query<{ tx_id: string }>(`SELECT tx_id FROM ledger_records WHERE shipment_id = $1 AND source = 'chaincode' AND tx_id IS NOT NULL`, [shipmentId])).rows;
  return new Set(rows.map(r => r.tx_id));
}
