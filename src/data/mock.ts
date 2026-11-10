import type { Part, Inventory, Location, Shipment, Transaction, Alert, DemoUser, AppData, DemandClass, ShipmentStatus, TxType } from '../types';
import { locations, identities } from '../utils/core';
const partNames = [
  'Hydraulic Pump Seal Kit', 'Fuel Filter Element', 'Landing Gear Bushing', 'Avionics Cooling Fan', 'Pressure Regulator', 'Actuator Assembly', 'Turbine Temperature Sensor', 'Ignition Exciter', 'Engine Oil Strainer', 'Fuel Control Valve', 'Brake Disc Set', 'Wheel Bearing Assembly', 'Starter Generator', 'Hydraulic Accumulator', 'Pitot Probe', 'Cabin Pressure Sensor', 'Cooling Duct', 'Engine Mount', 'Antenna Coupler', 'Servo Motor', 'Flow Meter', 'Oxygen Regulator', 'Filter Cartridge', 'Cargo Roller Assembly', 'Pump Impeller', 'Inverter Module', 'Bleed Air Valve', 'Electrical Harness', 'Control Relay', 'Deicing Valve', 'Oil Pressure Switch', 'Flight Control Link', 'Bearing Sleeve', 'Compressor Seal', 'Fan Blade Coupler', 'Fuel Nozzle Assembly', 'Hydraulic Hose', 'Fluid Level Transducer', 'Navigation Light', 'Landing Light Unit', 'Wiper Motor', 'Gasket Assembly', 'Actuator Rod', 'Gearbox Coupling', 'Flap Track Roller', 'Fire Detector Loop', 'Thermal Insulation', 'Power Supply Module', 'Micro Switch', 'Gear Retraction Sensor', 'Clutch Bearing', 'Air Intake Screen', 'Pneumatic Regulator', 'Stabilizer Hinge', 'Fuel Quantity Probe', 'Trim Actuator', 'Electrical Connector', 'Rotor Seal', 'Cooling Fan Motor', 'Valve Position Sensor'
];
export const PARTS: Part[] = partNames.map((name, i) => ({ id: `SP-${String(i + 1).padStart(3, '0')}`, name, demandClass: (['Smooth', 'Erratic', 'Intermittent', 'Lumpy'] as DemandClass[])[i < 8 ? 0 : i < 16 ? 1 : i < 42 ? 2 : 3], criticality: i % 7 === 0 ? 'Critical' : 'Standard', unit: 'units' }));
const mulberry = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
export const MONTHS = Array.from({ length: 72 }, (_, i) => new Date(Date.UTC(2020, 10 + i, 1)).toISOString().slice(0, 7));
export const futureMonths = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 10 + i, 1)).toISOString().slice(0, 7));
const dataMap = new Map<string, number[]>();
PARTS.forEach((p, i) => locations.forEach((loc, j) => { let r = mulberry(10121 + i * 997 + j * 37), base = 4 + r() * 14; let values = MONTHS.map((_, m) => { let prob = p.demandClass === 'Smooth' ? .94 : p.demandClass === 'Erratic' ? .81 : p.demandClass === 'Intermittent' ? .32 : .24; if (r() > prob) return 0; let swing = p.demandClass === 'Lumpy' ? 2.4 : p.demandClass === 'Erratic' ? 1.6 : 0.6; return Math.max(1, Math.round(base * (1 + (r() - .5) * swing) * (1 + .14 * Math.sin(m * Math.PI / 6)) * (j === 0 ? 1 : j === 1 ? .62 : .4))); }); dataMap.set(`${p.id}|${loc}`, values); }));
export function series(part: string, location: string) { if (location !== 'All locations') return dataMap.get(`${part}|${location}`) || []; return MONTHS.map((_, i) => locations.reduce((sum, loc) => sum + (dataMap.get(`${part}|${loc}`)?.[i] || 0), 0)); }
export function allDemandRecords() { return PARTS.flatMap(p => locations.flatMap(l => series(p.id, l).map((qty, i) => ({ partId: p.id, location: l, month: MONTHS[i], qty })))); }
const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
export const BASE_INVENTORY: Inventory[] = PARTS.flatMap((p, i) => locations.map((loc, j) => { const s = series(p.id, loc); const avg = average(s.slice(-24)); const r = mulberry(4401 + i * 11 + j); const leadDays = 20 + Math.floor(r() * 100); const leadDemand = avg * leadDays / 30.4; const safetyStock = Math.ceil(Math.max(3, avg * .65)); const reorderPoint = Math.ceil(leadDemand + safetyStock); const rate = i * 3 + j; const multiplier = rate % 17 === 0 ? .2 : rate % 13 === 0 ? .7 : rate % 11 === 0 ? .96 : 1.3 + r() * 1.25; const onHand = Math.round(reorderPoint * multiplier); const daysCover = avg ? onHand / (avg / 30.4) : 999; const status: Inventory['status'] = onHand < reorderPoint * .48 ? 'Stockout risk' : onHand < reorderPoint ? 'Below reorder point' : onHand < reorderPoint * 1.08 ? 'Watch' : 'Healthy'; return { id: `${p.id}-${j}`, partId: p.id, location: loc as Location, onHand, inTransit: 0, monthlyDemand: avg, leadDays, safetyStock, reorderPoint, leadDemand, daysCover, status, recommended: Math.max(0, Math.ceil(reorderPoint + avg * 2 - onHand)) }; }));
const names = ['Planner A. Harbi', 'Dispatcher M. Qahtani', 'Receiver S. Otaibi', 'Admin R. Dossary', 'Planner L. Anazi', 'Dispatcher N. Salem', 'Receiver T. Fahad', 'Planner H. Saud'];
export const INITIAL_USERS: DemoUser[] = names.map((name, i) => ({ id: `USR-${String(i + 1).padStart(3, '0')}`, name, email: name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.') + '@wethaq.demo', role: i === 0 || i > 6 ? 'Planner' : i === 1 || i === 5 ? 'Dispatcher' : i === 2 || i === 6 ? 'Receiver' : i === 3 ? 'Admin' : 'Planner', org: i === 1 || i === 5 ? 'Org1 (Issuing)' : i === 2 || i === 6 ? 'Org2 (Receiving)' : i === 3 ? 'System Administration' : 'Logistics Command', active: i !== 7, lastSeen: new Date(Date.UTC(2026, 10, 10 - i, 9, 25)).toISOString() }));
export const hash = (n: number) => Array.from({ length: 64 }, (_, i) => ((n * 37 + i * 17 + i * i * 3) % 16).toString(16)).join('');
export const makeTx = (id: string, type: TxType, ship: Shipment, quantity: number, actor: string, org: string, timestamp: string, block?: number, status: 'Committed' | 'Rejected' = 'Committed', reason?: string): Transaction => ({ id, type, shipmentId: ship.id, partId: ship.partId, quantity, org, user: actor, timestamp, block, hash: hash(block || id.length * 17), status, reason });
export function initialData(): AppData {
  const shipments: Shipment[] = []; const transactions: Transaction[] = []; let b = 1701;
  const progress: ShipmentStatus[] = ['Requested', 'Dispatched', 'In Transit', 'Received'];
  for (let i = 0; i < 48; i++) {
    const p = PARTS[(i * 7 + 2) % PARTS.length]; const status = progress[i % 4]; const quantity = 5 + (i * 3) % 44; const requestedAt = new Date(Date.UTC(2026, 9, 7 + i % 30, 8 + i % 8)).toISOString(); const id = `SHP-2026-${String(i + 1).padStart(4, '0')}`;
    const s: Shipment = { id, partId: p.id, quantity, dispatchedQty: undefined, receivedQty: undefined, from: 'Central Warehouse', to: i % 3 === 0 ? 'Deployment Site' : 'Distribution Center', status, requestedBy: identities.Planner.name, requestedAt, forecastMonth: '2026-11', note: 'Reviewed by planner · simulated scenario', expectedAt: new Date(new Date(requestedAt).getTime() + 14 * 86400000).toISOString(), recommendationId: `REC-${p.id}`, events: [{ status: 'Requested', time: requestedAt, actor: identities.Planner.name, org: 'Logistics Command' }] };
    const at = (d: number) => new Date(new Date(requestedAt).getTime() + d * 86400000).toISOString();
    if (status !== 'Requested') { s.dispatchedQty = quantity; s.events.push({ status: 'Dispatched', time: at(2), actor: identities.Dispatcher.name, org: identities.Dispatcher.org, txId: `TX-${String(b).padStart(6, '0')}` }); transactions.push(makeTx(`TX-${String(b++).padStart(6, '0')}`, 'DISPATCH', s, quantity, identities.Dispatcher.name, identities.Dispatcher.org, at(2), b + 8000)); }
    if (status === 'In Transit' || status === 'Received') { s.events.push({ status: 'In Transit', time: at(4), actor: identities.Dispatcher.name, org: identities.Dispatcher.org, txId: `TX-${String(b).padStart(6, '0')}` }); transactions.push(makeTx(`TX-${String(b++).padStart(6, '0')}`, 'STATUS_CHANGE', s, quantity, identities.Dispatcher.name, identities.Dispatcher.org, at(4), b + 8000)); }
    if (status === 'Received') { s.receivedQty = i === 11 ? quantity - 2 : quantity; s.events.push({ status: 'Received', time: at(7), actor: identities.Receiver.name, org: identities.Receiver.org, txId: `TX-${String(b).padStart(6, '0')}` }); transactions.push(makeTx(`TX-${String(b++).padStart(6, '0')}`, 'RECEIPT', s, s.receivedQty, identities.Receiver.name, identities.Receiver.org, at(7), b + 8000)); }
    shipments.push(s);
  }
  // Make initial demonstration scenarios include full records and ~10 rejections.
  const reasons = ['Duplicate receipt', 'Unauthorized organization', 'Invalid status transition', 'Quantity exceeds dispatched', 'Unknown shipment reference'];
  for (let i = 0; i < 10; i++) { const s = shipments[(i * 3 + 3) % shipments.length]; const t = makeTx(`TX-REJ-${String(i + 1).padStart(3, '0')}`, 'RECEIPT', s, s.quantity + 1, 'Demo validator', i % 2 ? 'Org1 (Issuing)' : 'Org2 (Receiving)', new Date(Date.UTC(2026, 10, 1 + i, 11)).toISOString(), undefined, 'Rejected', reasons[i % 5]); t.failedRule = ['noDuplicate', 'authorizedOrg', 'validTransition', 'validQuantity', 'validReference'][i % 5]; transactions.push(t); }
  const alerts: Alert[] = [];
  BASE_INVENTORY.filter(x => x.status === 'Stockout risk' || x.status === 'Below reorder point').slice(0, 9).forEach((r, i) => alerts.push({ id: `ALT-${String(i + 1).padStart(3, '0')}`, severity: r.status === 'Stockout risk' ? 'Critical' : 'High', type: 'Shortage', title: r.status === 'Stockout risk' ? 'Stockout risk identified' : 'Below reorder point', detail: `${r.partId} · ${r.location} · ${r.onHand} units on hand`, partId: r.partId, at: new Date(Date.UTC(2026, 10, 10, 12 - i)).toISOString(), acknowledged: i % 4 === 0 }));
  shipments.filter(s => s.status === 'In Transit').slice(0, 3).forEach((s, i) => alerts.push({ id: `ALT-D${i + 1}`, severity: 'Medium', type: 'Delay', title: 'Receipt confirmation pending', detail: `${s.id} · status requires follow-up`, shipmentId: s.id, at: new Date(Date.UTC(2026, 10, 9 - i, 16)).toISOString(), acknowledged: false }));
  alerts.push({ id: 'ALT-D4', severity: 'High', type: 'Discrepancy', title: 'Reported quantity mismatch', detail: 'Synthetic receipt reconciliation review', shipmentId: shipments[11].id, at: '2026-11-09T07:00:00Z', acknowledged: false });
  return { shipments, transactions, alerts, users: INITIAL_USERS };
}
export function computeInventory(shipments: Shipment[]): Inventory[] {
  const transit = new Map<string, number>(); const adjustments = new Map<string, number>();
  const adjust = (key: string, n: number) => adjustments.set(key, (adjustments.get(key) || 0) + n);
  for (const s of shipments) {
    if (['Dispatched', 'In Transit'].includes(s.status)) {
      const key = `${s.partId}-${s.to}`; transit.set(key, (transit.get(key) || 0) + (s.dispatchedQty || 0));
    }
    // The baseline dataset already includes old shipment effects; apply only newly created demo transfers.
    if (s.createdInSession) {
      if (s.dispatchedQty !== undefined) adjust(`${s.partId}-${s.from}`, -s.dispatchedQty);
      if (s.receivedQty !== undefined) adjust(`${s.partId}-${s.to}`, s.receivedQty);
    }
  }
  return BASE_INVENTORY.map(row => {
    const inTransit = transit.get(`${row.partId}-${row.location}`) || 0;
    const onHand = Math.max(0, row.onHand + (adjustments.get(`${row.partId}-${row.location}`) || 0));
    const daysCover = row.monthlyDemand > 0 ? onHand / (row.monthlyDemand / 30.4) : 999;
    const status: Inventory['status'] = onHand < row.reorderPoint * .48 ? 'Stockout risk' : onHand < row.reorderPoint ? 'Below reorder point' : onHand < row.reorderPoint * 1.08 ? 'Watch' : 'Healthy';
    return { ...row, inTransit, onHand, daysCover, status, recommended: Math.max(0, Math.ceil(row.reorderPoint + row.monthlyDemand * 2 - onHand - inTransit)) };
  });
}
