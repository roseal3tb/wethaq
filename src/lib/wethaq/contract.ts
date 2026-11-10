import { ROLE_ORG, type OperationKind, type OrgId, type Role, type RuleId, type Shipment, type ShipmentStatus, type Transaction } from "./types";

export interface RuleResult { id: RuleId; label: string; passed: boolean; detail: string; skipped?: boolean; }
export interface ValidationInput {
  kind: OperationKind;
  shipmentRef: string;
  qty: number;
  actorRole: Role;
  actorOrg: OrgId;
}
export interface ValidationResult { passed: boolean; rules: RuleResult[]; primaryFailure: RuleResult | null; fromStatus: ShipmentStatus | null; toStatus: ShipmentStatus; }

export const RULE_LABEL: Record<RuleId, string> = {
  authorizedOrg: "Authorized organization",
  validReference: "Valid shipment reference",
  validQuantity: "Valid quantity",
  validTransition: "Valid status transition",
  notDuplicateReceipt: "Not a duplicate receipt",
};

const REQUIRED: Record<OperationKind, { role: Role; from: ShipmentStatus[]; to: ShipmentStatus }> = {
  dispatch: { role: "Dispatcher", from: ["Requested"], to: "Dispatched" },
  transit: { role: "Dispatcher", from: ["Dispatched"], to: "In Transit" },
  receive: { role: "Receiver", from: ["Dispatched", "In Transit"], to: "Received" },
};

/** Simulated chaincode validation. Rules are evaluated independently so every failure is shown. */
export function validateOperation(input: ValidationInput, shipments: Shipment[], txs: Transaction[]): ValidationResult {
  const req = REQUIRED[input.kind];
  const ship = shipments.find((s) => s.id === input.shipmentRef.trim().toUpperCase());
  const rules: RuleResult[] = [];

  const orgOk = input.actorOrg === ROLE_ORG[req.role] && input.actorRole === req.role;
  rules.push({
    id: "authorizedOrg", label: RULE_LABEL.authorizedOrg, passed: orgOk,
    detail: orgOk ? `${input.actorOrg} (${input.actorRole}) may submit ${input.kind}` : `${input.kind} requires ${ROLE_ORG[req.role]} · ${req.role}; got ${input.actorOrg} · ${input.actorRole}`,
  });
  rules.push({
    id: "validReference", label: RULE_LABEL.validReference, passed: !!ship,
    detail: ship ? `${ship.id} found in world state` : `No shipment "${input.shipmentRef}" in world state`,
  });

  if (!ship) {
    for (const id of ["validQuantity", "validTransition", "notDuplicateReceipt"] as RuleId[])
      rules.push({ id, label: RULE_LABEL[id], passed: false, skipped: true, detail: "Not evaluated — reference unresolved" });
  } else {
    let qtyOk = true;
    let qtyDetail = "No quantity change for status update";
    if (input.kind === "dispatch") {
      qtyOk = Number.isInteger(input.qty) && input.qty > 0 && input.qty <= ship.qtyRequested;
      qtyDetail = qtyOk ? `${input.qty} ≤ requested ${ship.qtyRequested}` : `Dispatch qty ${input.qty} must be 1–${ship.qtyRequested}`;
    } else if (input.kind === "receive") {
      const disp = ship.qtyDispatched ?? 0;
      qtyOk = Number.isInteger(input.qty) && input.qty > 0 && input.qty <= disp;
      qtyDetail = qtyOk ? `${input.qty} ≤ dispatched ${disp}` : `Received qty ${input.qty} exceeds dispatched ${disp}`;
    }
    rules.push({ id: "validQuantity", label: RULE_LABEL.validQuantity, passed: qtyOk, detail: qtyDetail });
    const trOk = req.from.includes(ship.status);
    rules.push({
      id: "validTransition", label: RULE_LABEL.validTransition, passed: trOk,
      detail: trOk ? `${ship.status} → ${req.to}` : `${ship.status} → ${req.to} is not permitted (expects ${req.from.join(" or ")})`,
    });
    const dup = input.kind === "receive" && txs.some((t) => t.shipmentId === ship.id && t.type === "RECEIPT" && t.status === "Committed");
    rules.push({
      id: "notDuplicateReceipt", label: RULE_LABEL.notDuplicateReceipt, passed: !dup,
      detail: input.kind !== "receive" ? "Not applicable to this operation" : dup ? `A committed RECEIPT already exists for ${ship.id}` : "No prior receipt committed",
    });
  }
  const failed = rules.filter((r) => !r.passed && !r.skipped);
  const priority: RuleId[] = ["authorizedOrg", "validReference", "notDuplicateReceipt", "validQuantity", "validTransition"];
  const primaryFailure = priority.map((id) => failed.find((r) => r.id === id)).find((r): r is RuleResult => !!r) ?? null;
  return { passed: failed.length === 0, rules, primaryFailure, fromStatus: ship?.status ?? null, toStatus: req.to };
}
