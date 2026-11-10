export type DemandClass = "Smooth" | "Erratic" | "Intermittent" | "Lumpy";
export const DEMAND_CLASSES: DemandClass[] = ["Smooth", "Erratic", "Intermittent", "Lumpy"];
export type LocationId = "CW" | "DC" | "DS";
export type LocationFilter = LocationId | "ALL";
export const LOCATIONS: { id: LocationId; name: string; short: string }[] = [
  { id: "CW", name: "Central Warehouse", short: "Central WH" },
  { id: "DC", name: "Distribution Center", short: "Dist. Center" },
  { id: "DS", name: "Deployment Site", short: "Deploy. Site" },
];
export const locationName = (id: LocationFilter): string =>
  id === "ALL" ? "All locations" : (LOCATIONS.find((l) => l.id === id)?.name ?? id);

export interface Part {
  id: string;
  name: string;
  demandClass: DemandClass;
  leadTimeMonths: number;
  unitCostSar: number;
}

export type Role = "Planner" | "Dispatcher" | "Receiver" | "Admin";
export const ROLES: Role[] = ["Planner", "Dispatcher", "Receiver", "Admin"];
export const ROLE_LABEL: Record<Role, string> = {
  Planner: "Logistics Planner",
  Dispatcher: "Dispatcher",
  Receiver: "Receiver",
  Admin: "Admin",
};
export type OrgId = "LogisticsOrgMSP" | "SiteOrgMSP" | "OrdererOrgMSP";
export const ORG_LABEL: Record<OrgId, string> = {
  LogisticsOrgMSP: "Wethaq Logistics Org",
  SiteOrgMSP: "Deployment Site Org",
  OrdererOrgMSP: "Ordering Service Org",
};
export const ROLE_ORG: Record<Role, OrgId> = {
  Planner: "LogisticsOrgMSP",
  Dispatcher: "LogisticsOrgMSP",
  Receiver: "SiteOrgMSP",
  Admin: "LogisticsOrgMSP",
};

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: OrgId;
  active: boolean;
  lastActive: string;
}

export type ShipmentStatus = "Requested" | "Dispatched" | "In Transit" | "Received";
export const SHIPMENT_STATUSES: ShipmentStatus[] = ["Requested", "Dispatched", "In Transit", "Received"];

export interface ShipmentEvent {
  status: ShipmentStatus;
  at: string;
  actor: string;
  org: OrgId;
  txId?: string;
  note?: string;
}

export interface Shipment {
  id: string;
  partId: string;
  qtyRequested: number;
  qtyDispatched: number | null;
  qtyReceived: number | null;
  origin: string;
  destination: LocationId;
  status: ShipmentStatus;
  requestedBy: string;
  requestedAt: string;
  dispatchedAt: string | null;
  inTransitAt: string | null;
  receivedAt: string | null;
  expectedAt: string;
  recommendationRef: string;
  forecastMonth: string;
  reviewNote: string;
  events: ShipmentEvent[];
  createdInSession?: boolean;
}

export type TxType = "DISPATCH" | "STATUS_CHANGE" | "RECEIPT" | "ATTEMPT";
export type OperationKind = "dispatch" | "transit" | "receive";
export const OP_TX: Record<OperationKind, Exclude<TxType, "ATTEMPT">> = {
  dispatch: "DISPATCH",
  transit: "STATUS_CHANGE",
  receive: "RECEIPT",
};

export interface Endorsement {
  org: OrgId;
  peer: string;
  result: "ENDORSED" | "REJECTED" | "NOT_REQUESTED";
}

export interface Transaction {
  id: string;
  type: TxType;
  attemptedType?: Exclude<TxType, "ATTEMPT">;
  shipmentId: string;
  partId: string | null;
  qty: number;
  org: OrgId;
  user: string;
  timestamp: string;
  blockNumber: number | null;
  hash: string;
  status: "Committed" | "Rejected";
  rejectionReason: string | null;
  failedRule: RuleId | null;
  endorsements: Endorsement[];
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus | null;
}

export type RuleId = "authorizedOrg" | "validReference" | "validQuantity" | "validTransition" | "notDuplicateReceipt";

export type AlertType = "Shortage" | "Discrepancy" | "Delay" | "Rejected attempt";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export interface Alert {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  detail: string;
  createdAt: string;
  status: "New" | "Acknowledged";
  ackBy?: string;
  partId?: string;
  shipmentId?: string;
}

export type InventoryStatus = "Critical" | "Below ROP" | "Healthy" | "Overstock";
export interface InventoryRow {
  key: string;
  partId: string;
  partName: string;
  demandClass: DemandClass;
  location: LocationId;
  onHand: number;
  inTransit: number;
  monthlyRate: number;
  sigma: number;
  leadTimeMonths: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  daysOfCover: number | null;
  status: InventoryStatus;
  recommendedQty: number;
}
