import type { LedgerOperation, LedgerRecord, LedgerShipment, OrgMsp, RuleKey } from '../../../chaincode/shipment/src/rules.js';
export type { LedgerOperation, LedgerRecord, LedgerShipment, OrgMsp, RuleKey };

/** Result of a committed ledger transaction. A rejected business operation is still a committed ledger
 * transaction: the chaincode writes the rejected attempt and leaves the shipment unchanged (Case B). */
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

/**
 * A transaction that has been prepared but not yet submitted. Its transaction id is known before
 * submission, so the API records the operation durably first and can always find out what happened.
 */
export interface PreparedTransaction {
  readonly txId: string;
  /** Endorses, orders and waits for the commit. Resolves only for a valid commit; otherwise throws LedgerError. */
  submit(): Promise<LedgerOutcome>;
}

/**
 * Why a ledger submission did not produce a confirmed commit (Case C).
 * definite = the transaction is certainly not committed (safe to report a failure);
 * otherwise the outcome is unknown and must be reconciled before anything is reported or undone.
 */
export type LedgerFailure =
  | 'unavailable'      // no connection to the gateway or peers (not submitted)
  | 'endorsement'      // the peers did not endorse it (not submitted to ordering)
  | 'invalid'          // ordered but marked invalid at validation, e.g. MVCC_READ_CONFLICT (no state written)
  | 'submit'           // sending to the orderer failed: it may or may not have been ordered
  | 'commit_timeout';  // the commit status did not arrive in time: it may or may not have committed

export class LedgerError extends Error {
  constructor(public readonly category: LedgerFailure, message: string, public readonly txId?: string, public readonly code?: string) { super(message); }
  /** true when the transaction is certainly not on the ledger. */
  get definite() { return this.category === 'unavailable' || this.category === 'endorsement' || this.category === 'invalid'; }
}

/** What the ledger knows about one transaction id. */
export interface TransactionStatus {
  state: 'valid' | 'invalid' | 'not_found';
  /** Fabric validation code (for example VALID or MVCC_READ_CONFLICT) when known. */
  code?: string;
  block?: number;
}

/** A committed ledger transaction, as reported by the ledger's event stream. */
export interface LedgerCommitEvent {
  /** Chaincode event name: ShipmentRegistered, ShipmentUpdated or OperationRejected. */
  name: string;
  txId: string;
  block?: number;
  record: LedgerRecord;
}

export interface VerifyOutcome {
  found: boolean;
  match: boolean;
  differences: string[];
  ledger?: LedgerShipment;
}

export interface LedgerHealth {
  ok: boolean;
  detail: string;
  /** Fabric only: the application identities and when their certificates expire. */
  identities?: { msp: string; subject: string; expires: string; daysLeft: number }[];
}

export interface Ledger {
  readonly kind: 'local' | 'fabric';
  /** Prepares the registration of a planner's request (submitted through Org1, the issuing organization). */
  prepareRegister(input: { shipmentId: string; partId: string; requestedQty: number }): Promise<PreparedTransaction>;
  /** Prepares a dispatch, in-transit or receipt operation, signed by the given organization's identity. */
  prepareSubmit(input: { operation: LedgerOperation; shipmentId: string; qty: number; org: OrgMsp }): Promise<PreparedTransaction>;
  /** Shortcuts: prepare and submit at once (used by tools that do not need durable tracking). */
  registerRequest(input: { shipmentId: string; partId: string; requestedQty: number }): Promise<LedgerOutcome>;
  submit(input: { operation: LedgerOperation; shipmentId: string; qty: number; org: OrgMsp }): Promise<LedgerOutcome>;
  read(shipmentId: string): Promise<LedgerShipment | null>;
  history(shipmentId: string): Promise<LedgerRecord[]>;
  /** The record a transaction wrote, or null if the ledger has no record for it. */
  readRecord(txId: string): Promise<LedgerRecord | null>;
  /** Whether a transaction id was committed as valid, committed as invalid, or is unknown to the ledger. */
  transactionStatus(txId: string): Promise<TransactionStatus>;
  /** Compares an off-chain copy with the ledger state (on the peer, for Fabric). */
  verify(shipmentId: string, expected: Record<string, unknown>): Promise<VerifyOutcome>;
  /**
   * Calls the listener for every committed transaction, in block order, including those from other clients.
   * fromBlock resumes after a checkpoint (Fabric); the listener is awaited before the next event.
   * Returns a function that stops listening.
   */
  onCommit(listener: (event: LedgerCommitEvent) => void | Promise<void>, options?: { fromBlock?: number }): () => void;
  /** The number of blocks on the channel (block numbers run from 0 for Fabric, 1 for the local ledger, up to height - 1). */
  height(): Promise<number>;
  health(): Promise<LedgerHealth>;
  close(): Promise<void>;
}
