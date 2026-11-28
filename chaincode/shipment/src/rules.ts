/**
 * The five Wethaq transaction rules, as enforced by the shipment chaincode.
 * This module has no Fabric dependency so that the same rules run in the chaincode,
 * in the API's local development ledger, and in unit tests.
 * Priority order (Appendix D): authorizedOrg, validReference, noDuplicate, validQuantity, validTransition.
 *
 * Version 2 (GP2) adds cancellation, partial receipts and returns (blocker B5). The five rules and their
 * priority are unchanged; they apply to the new operations as well:
 *   cancel          Org1, from Requested or Dispatched              -> Cancelled (no quantity)
 *   receivePartial  Org2, from Dispatched, In Transit or Partially Received; quantity below what is still
 *                   outstanding                                     -> Partially Received
 *   receive         Org2, from the same states; quantity up to what is still outstanding -> Received
 *   return          Org2, from Received; quantity up to the received quantity           -> Returned
 * Received quantities add up across partial receipts and the final receipt. Records and shipments written by
 * version 1 read the same way under version 2.
 */
export type LedgerOperation = 'dispatch' | 'transit' | 'receive' | 'receivePartial' | 'cancel' | 'return';
export type LedgerStatus = 'Requested' | 'Dispatched' | 'In Transit' | 'Partially Received' | 'Received' | 'Cancelled' | 'Returned';
export const LEDGER_OPERATIONS: LedgerOperation[] = ['dispatch', 'transit', 'receive', 'receivePartial', 'cancel', 'return'];
export const LEDGER_STATUSES: LedgerStatus[] = ['Requested', 'Dispatched', 'In Transit', 'Partially Received', 'Received', 'Cancelled', 'Returned'];
export type OrgMsp = 'Org1MSP' | 'Org2MSP';

/** The shipment state kept on the ledger (on-chain data only, Table 4.8). */
export interface LedgerShipment {
  docType: 'shipment';
  shipmentId: string;
  partId: string;
  requestedQty: number;
  dispatchedQty?: number;
  receivedQty?: number;
  returnedQty?: number;
  status: LedgerStatus;
  updatedAt: string;
  lastTxId: string;
}

export interface RuleResult { key: RuleKey; label: string; passed: boolean; detail: string; }
export type RuleKey = 'authorizedOrg' | 'validReference' | 'validQuantity' | 'validTransition' | 'noDuplicate';
export interface RuleCheck { passed: boolean; rules: RuleResult[]; failedRule?: RuleKey; failure?: string; reason?: string; }

export const RULE_LABELS: Record<RuleKey, string> = {
  authorizedOrg: 'Authorized organization', validReference: 'Valid shipment reference', noDuplicate: 'No duplicate receipt',
  validQuantity: 'Valid quantity', validTransition: 'Valid status transition'
};
export const RULE_PRIORITY: RuleKey[] = ['authorizedOrg', 'validReference', 'noDuplicate', 'validQuantity', 'validTransition'];
export const REQUIRED_MSP: Record<LedgerOperation, OrgMsp> = { dispatch: 'Org1MSP', transit: 'Org1MSP', receive: 'Org2MSP', receivePartial: 'Org2MSP', cancel: 'Org1MSP', return: 'Org2MSP' };
export const NEXT_STATUS: Record<LedgerOperation, LedgerStatus> = { dispatch: 'Dispatched', transit: 'In Transit', receive: 'Received', receivePartial: 'Partially Received', cancel: 'Cancelled', return: 'Returned' };
const RECEIVING_FROM: LedgerStatus[] = ['Dispatched', 'In Transit', 'Partially Received'];
export const ALLOWED_FROM: Record<LedgerOperation, LedgerStatus[]> = { dispatch: ['Requested'], transit: ['Dispatched'], receive: RECEIVING_FROM, receivePartial: RECEIVING_FROM, cancel: ['Requested', 'Dispatched'], return: ['Received'] };
/** Operations that carry no quantity of their own. */
export const NO_QUANTITY: LedgerOperation[] = ['transit', 'cancel'];
const isReceipt = (operation: LedgerOperation) => operation === 'receive' || operation === 'receivePartial';

/** The most an operation may carry: requested for a dispatch, still outstanding for a receipt, received for a return. */
export function quantityLimit(operation: LedgerOperation, shipment: LedgerShipment | null | undefined): number {
  if (!shipment) return 0;
  if (operation === 'dispatch') return shipment.requestedQty;
  if (isReceipt(operation)) return Math.max(0, (shipment.dispatchedQty ?? 0) - (shipment.receivedQty ?? 0));
  if (operation === 'return') return shipment.receivedQty ?? 0;
  return 0;
}
const ORG_LABEL: Record<OrgMsp, string> = { Org1MSP: 'Org1 (Issuing)', Org2MSP: 'Org2 (Receiving)' };

export function checkRules(operation: LedgerOperation, shipment: LedgerShipment | null | undefined, qty: number, submitter: string): RuleCheck {
  const required = REQUIRED_MSP[operation];
  const authorized = submitter === required;
  const exists = !!shipment;
  const limit = quantityLimit(operation, shipment);
  const noQuantity = NO_QUANTITY.includes(operation);
  // A partial receipt must leave something outstanding; the last part is recorded with receive.
  const max = operation === 'receivePartial' ? limit - 1 : limit;
  const validQty = noQuantity || (Number.isInteger(qty) && qty > 0 && exists && qty <= max);
  const validTransition = exists && ALLOWED_FROM[operation].includes(shipment!.status);
  // A receipt is a duplicate once the shipment is fully received (or returned). Before version 2 any receipt
  // closed the shipment, so a received quantity outside Partially Received also counts.
  const duplicate = isReceipt(operation) && exists && (shipment!.status === 'Received' || shipment!.status === 'Returned'
    || (shipment!.receivedQty !== undefined && shipment!.status !== 'Partially Received'));
  const qtyDetail = noQuantity ? 'No quantity update'
    : operation === 'receivePartial' ? `A partial receipt must be a positive whole number below the ${limit} still outstanding`
    : `Quantity must be a positive whole number no higher than ${limit}`;
  const rules: RuleResult[] = [
    { key: 'authorizedOrg', label: 'Authorized organization', passed: authorized, detail: authorized ? `Submitted by ${ORG_LABEL[required]}` : `Requires ${ORG_LABEL[required]}; submitted by ${ORG_LABEL[submitter as OrgMsp] ?? submitter}` },
    { key: 'validReference', label: 'Valid shipment reference', passed: exists, detail: exists ? 'Shipment reference found on the ledger' : 'Shipment reference not found on the ledger' },
    { key: 'validQuantity', label: 'Valid quantity', passed: validQty, detail: qtyDetail },
    { key: 'validTransition', label: 'Valid status transition', passed: validTransition, detail: validTransition ? 'Transition permitted' : `${NEXT_STATUS[operation]} is not permitted from ${shipment?.status ?? 'an unknown state'}` },
    { key: 'noDuplicate', label: 'No duplicate receipt', passed: !duplicate, detail: duplicate ? 'Receipt already committed' : 'No duplicate detected' }
  ];
  const first = RULE_PRIORITY.map(k => rules.find(r => r.key === k && !r.passed)).find(Boolean);
  return first ? { passed: false, rules, failedRule: first.key, failure: first.label, reason: first.detail } : { passed: true, rules };
}

/** Applies an accepted operation to the ledger state. */
export function applyOperation(shipment: LedgerShipment, operation: LedgerOperation, qty: number, txId: string, at: string): LedgerShipment {
  return {
    ...shipment,
    status: NEXT_STATUS[operation],
    dispatchedQty: operation === 'dispatch' ? qty : shipment.dispatchedQty,
    receivedQty: isReceipt(operation) ? (shipment.receivedQty ?? 0) + qty : shipment.receivedQty,
    returnedQty: operation === 'return' ? qty : shipment.returnedQty,
    updatedAt: at,
    lastTxId: txId
  };
}

/** The quantity a record carries: the operation's own, or the dispatched quantity for transit and cancel. */
export function recordQuantity(operation: LedgerOperation, shipment: LedgerShipment | null | undefined, qty: number): number {
  if (NO_QUANTITY.includes(operation)) return shipment?.dispatchedQty ?? 0;
  return Number.isFinite(qty) ? qty : 0;
}

/** A transfer record written to the ledger for every operation, accepted or rejected. */
export interface LedgerRecord {
  docType: 'record';
  txId: string;
  shipmentId: string;
  partId: string;
  operation: LedgerOperation | 'request';
  quantity: number;
  org: string;
  fromStatus?: LedgerStatus;
  toStatus?: LedgerStatus;
  status: 'Committed' | 'Rejected';
  failedRule?: RuleKey;
  reason?: string;
  timestamp: string;
}

/** Fields of the on-chain shipment state that an off-chain copy can be checked against. */
export const VERIFIED_FIELDS = ['partId', 'requestedQty', 'dispatchedQty', 'receivedQty', 'returnedQty', 'status', 'lastTxId'] as const;
export type VerifiedField = typeof VERIFIED_FIELDS[number];
const FIELD_LABELS: Record<VerifiedField, string> = {
  partId: 'Part', requestedQty: 'Requested quantity', dispatchedQty: 'Dispatched quantity', receivedQty: 'Received quantity', returnedQty: 'Returned quantity', status: 'Status', lastTxId: 'Last transaction'
};

/** Lists the fields where an off-chain copy differs from the ledger state (only the fields the copy states). */
export function compareShipment(expected: Partial<Record<VerifiedField, unknown>>, ledger: LedgerShipment): string[] {
  return VERIFIED_FIELDS.filter(f => f in expected && (expected[f] ?? null) !== (ledger[f] ?? null))
    .map(f => `${FIELD_LABELS[f]}: database ${expected[f] ?? '—'}, ledger ${ledger[f] ?? '—'}`);
}
