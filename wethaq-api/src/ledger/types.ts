import type { LedgerOperation, LedgerRecord, LedgerShipment, OrgMsp, RuleKey } from '../../../chaincode/shipment/src/rules.js';
export type { LedgerOperation, LedgerRecord, LedgerShipment, OrgMsp, RuleKey };

/** Result of a submitted ledger transaction. A rejected operation is still a committed ledger
 * transaction: the chaincode writes the rejected attempt and leaves the shipment unchanged. */
export interface LedgerOutcome {
  passed: boolean;
  txId: string;
  block?: number;
  timestamp: string;
  record: LedgerRecord;
  shipment?: LedgerShipment;
  failedRule?: RuleKey;
  failure?: string;
  reason?: string;
}

export interface Ledger {
  readonly kind: 'local' | 'fabric';
  /** Registers a planner's shipment request on the ledger (submitted through Org1, the issuing organization). */
  registerRequest(input: { shipmentId: string; partId: string; requestedQty: number }): Promise<LedgerOutcome>;
  /** Submits a dispatch, in-transit or receipt operation as the given peer organization. */
  submit(input: { operation: LedgerOperation; shipmentId: string; qty: number; org: OrgMsp }): Promise<LedgerOutcome>;
  read(shipmentId: string): Promise<LedgerShipment | null>;
  history(shipmentId: string): Promise<LedgerRecord[]>;
  /** Calls the listener for every transaction committed on the ledger, including those submitted by other clients. Returns an unsubscribe function. */
  onCommit(listener: (event: LedgerCommitEvent) => void): () => void;
  close(): Promise<void>;
}

/** A committed ledger transaction, as reported by the ledger's event stream. */
export interface LedgerCommitEvent {
  /** Chaincode event name: ShipmentRegistered, ShipmentUpdated or OperationRejected. */
  name: string;
  txId: string;
  block?: number;
  record: LedgerRecord;
}
