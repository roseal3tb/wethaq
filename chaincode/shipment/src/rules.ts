/**
 * The five Wethaq transaction rules, as enforced by the shipment chaincode.
 * This module has no Fabric dependency so that the same rules run in the chaincode,
 * in the API's local development ledger, and in unit tests.
 * Priority order (Appendix D): authorizedOrg, validReference, noDuplicate, validQuantity, validTransition.
 */
export type LedgerOperation = 'dispatch' | 'transit' | 'receive';
export type LedgerStatus = 'Requested' | 'Dispatched' | 'In Transit' | 'Received';
export type OrgMsp = 'Org1MSP' | 'Org2MSP';

/** The shipment state kept on the ledger (on-chain data only, Table 4.8). */
export interface LedgerShipment {
  docType: 'shipment';
  shipmentId: string;
  partId: string;
  requestedQty: number;
  dispatchedQty?: number;
  receivedQty?: number;
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
export const REQUIRED_MSP: Record<LedgerOperation, OrgMsp> = { dispatch: 'Org1MSP', transit: 'Org1MSP', receive: 'Org2MSP' };
export const NEXT_STATUS: Record<LedgerOperation, LedgerStatus> = { dispatch: 'Dispatched', transit: 'In Transit', receive: 'Received' };
const ALLOWED_FROM: Record<LedgerOperation, LedgerStatus[]> = { dispatch: ['Requested'], transit: ['Dispatched'], receive: ['Dispatched', 'In Transit'] };
const ORG_LABEL: Record<OrgMsp, string> = { Org1MSP: 'Org1 (Issuing)', Org2MSP: 'Org2 (Receiving)' };

export function checkRules(operation: LedgerOperation, shipment: LedgerShipment | null | undefined, qty: number, submitter: string): RuleCheck {
  const required = REQUIRED_MSP[operation];
  const authorized = submitter === required;
  const exists = !!shipment;
  const limit = !shipment ? 0 : operation === 'dispatch' ? shipment.requestedQty : (shipment.dispatchedQty ?? 0);
  const validQty = operation === 'transit' || (Number.isInteger(qty) && qty > 0 && exists && qty <= limit);
  const validTransition = exists && ALLOWED_FROM[operation].includes(shipment!.status);
  const duplicate = operation === 'receive' && exists && (shipment!.status === 'Received' || shipment!.receivedQty !== undefined);
  const rules: RuleResult[] = [
    { key: 'authorizedOrg', label: 'Authorized organization', passed: authorized, detail: authorized ? `Submitted by ${ORG_LABEL[required]}` : `Requires ${ORG_LABEL[required]}; submitted by ${ORG_LABEL[submitter as OrgMsp] ?? submitter}` },
    { key: 'validReference', label: 'Valid shipment reference', passed: exists, detail: exists ? 'Shipment reference found on the ledger' : 'Shipment reference not found on the ledger' },
    { key: 'validQuantity', label: 'Valid quantity', passed: validQty, detail: operation === 'transit' ? 'No quantity update' : `Quantity must be a positive whole number no higher than ${limit}` },
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
    receivedQty: operation === 'receive' ? qty : shipment.receivedQty,
    updatedAt: at,
    lastTxId: txId
  };
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
export const VERIFIED_FIELDS = ['partId', 'requestedQty', 'dispatchedQty', 'receivedQty', 'status', 'lastTxId'] as const;
export type VerifiedField = typeof VERIFIED_FIELDS[number];
const FIELD_LABELS: Record<VerifiedField, string> = {
  partId: 'Part', requestedQty: 'Requested quantity', dispatchedQty: 'Dispatched quantity', receivedQty: 'Received quantity', status: 'Status', lastTxId: 'Last transaction'
};

/** Lists the fields where an off-chain copy differs from the ledger state (only the fields the copy states). */
export function compareShipment(expected: Partial<Record<VerifiedField, unknown>>, ledger: LedgerShipment): string[] {
  return VERIFIED_FIELDS.filter(f => f in expected && (expected[f] ?? null) !== (ledger[f] ?? null))
    .map(f => `${FIELD_LABELS[f]}: database ${expected[f] ?? '—'}, ledger ${ledger[f] ?? '—'}`);
}
