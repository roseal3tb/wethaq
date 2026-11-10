export type Role = 'Planner' | 'Dispatcher' | 'Receiver' | 'Admin';
export type DemandClass = 'Smooth' | 'Erratic' | 'Intermittent' | 'Lumpy';
export type Location = 'Central Warehouse' | 'Distribution Center' | 'Deployment Site';
export type ShipmentStatus = 'Requested' | 'Dispatched' | 'In Transit' | 'Received';
export type TxType = 'DISPATCH' | 'STATUS_CHANGE' | 'RECEIPT' | 'ATTEMPT';
export type TxStatus = 'Committed' | 'Rejected';
export type Operation = 'dispatch' | 'transit' | 'receive';
export interface Part { id: string; name: string; demandClass: DemandClass; criticality: 'Critical' | 'Standard'; unit: string; }
export interface Inventory { id: string; partId: string; location: Location; onHand: number; inTransit: number; monthlyDemand: number; leadDays: number; safetyStock: number; reorderPoint: number; leadDemand: number; daysCover: number; status: 'Healthy' | 'Watch' | 'Below reorder point' | 'Stockout risk'; recommended: number; }
export interface Event { status: ShipmentStatus; time: string; actor: string; org: string; txId?: string; note?: string; }
export interface Shipment { id: string; partId: string; quantity: number; dispatchedQty?: number; receivedQty?: number; from: Location; to: Location; status: ShipmentStatus; requestedBy: string; requestedAt: string; forecastMonth: string; note: string; expectedAt: string; recommendationId?: string; createdInSession?: boolean; events: Event[]; }
export interface Transaction { id: string; type: TxType; shipmentId: string; partId: string; quantity: number; org: string; user: string; timestamp: string; block?: number; hash: string; status: TxStatus; reason?: string; failedRule?: string; fromStatus?: ShipmentStatus; toStatus?: ShipmentStatus; }
export interface Alert { id: string; severity: 'Critical' | 'High' | 'Medium' | 'Low'; type: 'Shortage' | 'Discrepancy' | 'Delay' | 'Rejected attempt'; title: string; detail: string; partId?: string; shipmentId?: string; at: string; acknowledged: boolean; }
export interface DemoUser { id: string; name: string; email: string; role: Role; org: string; active: boolean; lastSeen: string; }
export interface AppData { shipments: Shipment[]; transactions: Transaction[]; alerts: Alert[]; users: DemoUser[]; }
export type Rule = { key: string; label: string; passed: boolean; detail: string; };
export interface CheckResult { passed: boolean; rules: Rule[]; failure?: string; }
