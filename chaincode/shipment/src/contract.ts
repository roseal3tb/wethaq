import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { applyOperation, checkRules, compareShipment, NEXT_STATUS, type LedgerOperation, type LedgerRecord, type LedgerShipment } from './rules';

const RECORD = 'record';
/** Index from a transaction id to its record (composite key tx~txId), for ReadTransactionRecord. */
const TX_INDEX = 'tx';
const MAX_PAGE = 200;

/** Serialises with sorted keys, so every endorsing peer writes byte-identical values. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface Outcome { passed: boolean; record: LedgerRecord; shipment?: LedgerShipment; failedRule?: string; failure?: string; reason?: string; }

/**
 * Wethaq shipment contract.
 * World state holds one entry per shipment (key = shipment id) and one entry per submitted operation
 * (composite key record~shipmentId~txId). A rejected operation does not change the shipment but is
 * still written as a record, so every attempt is kept on the ledger with its failed rule.
 * Only the limited transfer data of Table 4.8 is stored: no names, notes or inventory levels.
 */
@Info({ title: 'WethaqShipment', description: 'Shipment transfer records for Wethaq' })
export class ShipmentContract extends Contract {
  constructor() { super('WethaqShipment'); }

  private timestamp(ctx: Context): string {
    const ts = ctx.stub.getTxTimestamp();
    const raw = ts.seconds as unknown as number | { toNumber?: () => number; low?: number };
    const seconds = typeof raw === 'number' ? raw : raw.toNumber ? raw.toNumber() : Number(raw.low);
    return new Date(seconds * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
  }

  private async getShipment(ctx: Context, shipmentId: string): Promise<LedgerShipment | null> {
    const bytes = await ctx.stub.getState(shipmentId);
    return bytes && bytes.length ? JSON.parse(Buffer.from(bytes).toString('utf8')) as LedgerShipment : null;
  }

  private async putRecord(ctx: Context, record: LedgerRecord) {
    const key = ctx.stub.createCompositeKey(RECORD, [record.shipmentId, record.txId]);
    await ctx.stub.putState(key, Buffer.from(stableStringify(record)));
    await ctx.stub.putState(ctx.stub.createCompositeKey(TX_INDEX, [record.txId]), Buffer.from(stableStringify({ shipmentId: record.shipmentId })));
  }

  private static readonly SHIPMENT_ID = /^[A-Za-z0-9-]{1,64}$/;

  /** Registers a planner's approved request. Submitted by the issuing organization (Org1). */
  @Transaction()
  @Returns('string')
  public async RegisterRequest(ctx: Context, shipmentId: string, partId: string, requestedQty: string): Promise<string> {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'Org1MSP') throw new Error(`Only Org1 (Issuing) can register shipment requests; caller is ${msp}`);
    if (!/^[A-Z0-9-]{1,64}$/.test(shipmentId) || !/^SP-\d{3}$/.test(partId)) throw new Error('Invalid shipment or part identifier');
    const qty = Number(requestedQty);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Requested quantity must be a positive whole number');
    if (await this.getShipment(ctx, shipmentId)) throw new Error(`Shipment ${shipmentId} already exists`);
    const txId = ctx.stub.getTxID(); const timestamp = this.timestamp(ctx);
    const shipment: LedgerShipment = { docType: 'shipment', shipmentId, partId, requestedQty: qty, status: 'Requested', updatedAt: timestamp, lastTxId: txId };
    const record: LedgerRecord = { docType: 'record', txId, shipmentId, partId, operation: 'request', quantity: qty, org: msp, toStatus: 'Requested', status: 'Committed', timestamp };
    await ctx.stub.putState(shipmentId, Buffer.from(stableStringify(shipment)));
    await this.putRecord(ctx, record);
    ctx.stub.setEvent('ShipmentRegistered', Buffer.from(stableStringify(record)));
    return stableStringify({ passed: true, record, shipment } satisfies Outcome);
  }

  @Transaction()
  @Returns('string')
  public async Dispatch(ctx: Context, shipmentId: string, qty: string): Promise<string> { return this.operate(ctx, 'dispatch', shipmentId, Number(qty)); }

  @Transaction()
  @Returns('string')
  public async MarkInTransit(ctx: Context, shipmentId: string): Promise<string> { return this.operate(ctx, 'transit', shipmentId, 0); }

  @Transaction()
  @Returns('string')
  public async Receive(ctx: Context, shipmentId: string, qty: string): Promise<string> { return this.operate(ctx, 'receive', shipmentId, Number(qty)); }

  private async operate(ctx: Context, operation: LedgerOperation, shipmentId: string, qty: number): Promise<string> {
    if (typeof shipmentId !== 'string' || !ShipmentContract.SHIPMENT_ID.test(shipmentId)) throw new Error('Invalid shipment identifier');
    const msp = ctx.clientIdentity.getMSPID();
    const txId = ctx.stub.getTxID(); const timestamp = this.timestamp(ctx);
    const current = await this.getShipment(ctx, shipmentId);
    const check = checkRules(operation, current, qty, msp);
    const record: LedgerRecord = {
      docType: 'record', txId, shipmentId, partId: current?.partId ?? 'N/A', operation,
      quantity: operation === 'transit' ? (current?.dispatchedQty ?? 0) : (Number.isFinite(qty) ? qty : 0), org: msp,
      fromStatus: current?.status, toStatus: check.passed ? NEXT_STATUS[operation] : undefined,
      status: check.passed ? 'Committed' : 'Rejected', failedRule: check.failedRule, reason: check.reason, timestamp
    };
    let shipment = current ?? undefined;
    if (check.passed && current) {
      shipment = applyOperation(current, operation, record.quantity, txId, timestamp);
      await ctx.stub.putState(shipmentId, Buffer.from(stableStringify(shipment)));
    }
    await this.putRecord(ctx, record);
    ctx.stub.setEvent(check.passed ? 'ShipmentUpdated' : 'OperationRejected', Buffer.from(stableStringify(record)));
    return stableStringify({ passed: check.passed, record, shipment, failedRule: check.failedRule, failure: check.failure, reason: check.reason } satisfies Outcome);
  }

  @Transaction(false)
  @Returns('string')
  public async ReadShipment(ctx: Context, shipmentId: string): Promise<string> {
    const shipment = await this.getShipment(ctx, shipmentId);
    return shipment ? stableStringify(shipment) : '';
  }

  /** One transaction record by its Fabric transaction id, or '' when the ledger has no such record. */
  @Transaction(false)
  @Returns('string')
  public async ReadTransactionRecord(ctx: Context, txId: string): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(txId)) throw new Error('Invalid transaction id');
    const pointer = await ctx.stub.getState(ctx.stub.createCompositeKey(TX_INDEX, [txId]));
    if (!pointer || !pointer.length) return '';
    const { shipmentId } = JSON.parse(Buffer.from(pointer).toString('utf8')) as { shipmentId: string };
    const bytes = await ctx.stub.getState(ctx.stub.createCompositeKey(RECORD, [shipmentId, txId]));
    return bytes && bytes.length ? Buffer.from(bytes).toString('utf8') : '';
  }

  /**
   * Transaction records, optionally for one shipment and filtered by operation and outcome, one page at a time.
   * Arguments: shipmentId ('' for all), operation ('' or request/dispatch/transit/receive),
   * status ('' or Committed/Rejected), pageSize (1-200), bookmark ('' for the first page).
   */
  @Transaction(false)
  @Returns('string')
  public async QueryTransactionRecords(ctx: Context, shipmentId: string, operation: string, status: string, pageSize: string, bookmark: string): Promise<string> {
    if (shipmentId && !ShipmentContract.SHIPMENT_ID.test(shipmentId)) throw new Error('Invalid shipment identifier');
    if (operation && !['request', 'dispatch', 'transit', 'receive'].includes(operation)) throw new Error('Invalid operation');
    if (status && !['Committed', 'Rejected'].includes(status)) throw new Error('Invalid status');
    const size = Number(pageSize || 50);
    if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) throw new Error(`pageSize must be between 1 and ${MAX_PAGE}`);
    const { iterator, metadata } = await ctx.stub.getStateByPartialCompositeKeyWithPagination(RECORD, shipmentId ? [shipmentId] : [], size, bookmark || '');
    const records: LedgerRecord[] = [];
    try {
      for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
        const record = JSON.parse(Buffer.from(res.value.value).toString('utf8')) as LedgerRecord;
        if ((!operation || record.operation === operation) && (!status || record.status === status)) records.push(record);
      }
    } finally { await iterator.close(); }
    return stableStringify({ records, bookmark: metadata?.bookmark ?? '', fetched: metadata?.fetchedRecordsCount ?? records.length });
  }

  /**
   * Compares an off-chain copy of a shipment with the ledger state, on the peer.
   * expected: JSON with any of partId, requestedQty, dispatchedQty, receivedQty, status, lastTxId.
   * Returns { found, match, differences[], ledger }. Read-only: it never changes the ledger.
   */
  @Transaction(false)
  @Returns('string')
  public async VerifyShipment(ctx: Context, shipmentId: string, expected: string): Promise<string> {
    let claim: Record<string, unknown>;
    try { claim = JSON.parse(expected || '{}'); } catch { throw new Error('expected must be JSON'); }
    const shipment = await this.getShipment(ctx, shipmentId);
    if (!shipment) return stableStringify({ found: false, match: false, differences: ['The shipment has no ledger record'] });
    const differences = compareShipment(claim, shipment);
    return stableStringify({ found: true, match: differences.length === 0, differences, ledger: shipment });
  }

  /** Every record (accepted or rejected) for one shipment, in commit order. */
  @Transaction(false)
  @Returns('string')
  public async GetHistory(ctx: Context, shipmentId: string): Promise<string> {
    const records: LedgerRecord[] = [];
    const iterator = await ctx.stub.getStateByPartialCompositeKey(RECORD, [shipmentId]);
    try {
      for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
        records.push(JSON.parse(Buffer.from(res.value.value).toString('utf8')));
      }
    } finally { await iterator.close(); }
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.txId.localeCompare(b.txId));
    return stableStringify(records);
  }
}
