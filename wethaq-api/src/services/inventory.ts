import type { Queryable } from '../db.js';
import { LOCATIONS, locationName } from './common.js';

export type StockStatus = 'Healthy' | 'Watch' | 'Below reorder point' | 'Stockout risk';

/** One inventory position, in the shape of the dashboard's Inventory type (src/types.ts). */
export interface InventoryPosition {
  id: string; partId: string; location: string;
  onHand: number; inTransit: number; monthlyDemand: number; leadDays: number; safetyStock: number;
  reorderPoint: number; leadDemand: number; daysCover: number; status: StockStatus; recommended: number;
  updatedAt: string;
}

/**
 * The inventory policy of the dashboard (src/data/mock.ts computeInventory), applied to the stock levels
 * stored in PostgreSQL. Reorder decisions use the inventory position: stock on hand plus stock already
 * dispatched to the location (Sprint 4 rule). A month is 30.4 days.
 */
export function classify(onHand: number, inTransit: number, reorderPoint: number, monthlyDemand: number) {
  const position = onHand + inTransit;
  const status: StockStatus = position < reorderPoint * 0.48 ? 'Stockout risk' : position < reorderPoint ? 'Below reorder point' : position < reorderPoint * 1.08 ? 'Watch' : 'Healthy';
  const daysCover = monthlyDemand > 0 ? onHand / (monthlyDemand / 30.4) : 999;
  const recommended = Math.max(0, Math.ceil(reorderPoint + monthlyDemand * 2 - onHand - inTransit));
  return { status, daysCover, recommended };
}

export async function inventoryPositions(q: Queryable, filter: { partId?: string; location?: string } = {}): Promise<InventoryPosition[]> {
  const params: unknown[] = []; const where: string[] = [];
  if (filter.partId) { params.push(filter.partId); where.push(`i.part_id = $${params.length}`); }
  if (filter.location) { params.push(filter.location); where.push(`i.location_id = $${params.length}`); }
  const rows = (await q.query<Record<string, any>>(
    `SELECT i.*, COALESCE(t.in_transit, 0)::int AS in_transit
       FROM inventory i
       LEFT JOIN (SELECT part_id, to_location, SUM(COALESCE(dispatched_qty, 0)) AS in_transit
                    FROM shipments WHERE status IN ('Dispatched', 'In Transit') GROUP BY part_id, to_location) t
         ON t.part_id = i.part_id AND t.to_location = i.location_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.part_id, i.location_id`, params)).rows;
  return rows.map(r => {
    const monthlyDemand = Number(r.monthly_demand);
    const leadDemand = monthlyDemand * r.lead_days / 30.4;
    const order = LOCATIONS.findIndex(l => l.id === r.location_id);
    return {
      id: `${r.part_id}-${order}`, partId: r.part_id, location: locationName(r.location_id),
      onHand: r.on_hand, inTransit: r.in_transit, monthlyDemand, leadDays: r.lead_days, safetyStock: r.safety_stock,
      reorderPoint: r.reorder_point, leadDemand, updatedAt: new Date(r.updated_at).toISOString(),
      ...classify(r.on_hand, r.in_transit, r.reorder_point, monthlyDemand)
    };
  });
}

/**
 * Raises one open shortage alert per at-risk position (deduplicated by part and location), after a
 * stock change. An acknowledged alert can be raised again if the position is still at risk later.
 */
export async function checkShortage(q: Queryable, partId: string, locationId: string, at: string) {
  const [row] = await inventoryPositions(q, { partId, location: locationId });
  if (!row || (row.status !== 'Stockout risk' && row.status !== 'Below reorder point')) return;
  await raiseAlert(q, {
    type: 'Shortage', severity: row.status === 'Stockout risk' ? 'Critical' : 'High',
    title: row.status === 'Stockout risk' ? 'Stockout risk identified' : 'Below reorder point',
    detail: `${partId} · ${row.location} · ${row.onHand} units on hand`, partId, at, dedupeKey: `shortage:${partId}:${row.location}`
  });
}

export interface AlertInput {
  type: 'Shortage' | 'Discrepancy' | 'Delay' | 'Rejected attempt' | 'Ledger sync' | 'Pending transaction';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  title: string; detail: string; partId?: string | null; shipmentId?: string | null; at: string; dedupeKey: string;
}

/** Inserts an alert unless an open alert with the same key exists. Returns true when a new alert was created. */
export async function raiseAlert(q: Queryable, a: AlertInput): Promise<boolean> {
  const id = `ALT-${a.dedupeKey.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const res = await q.query(
    `INSERT INTO alerts (alert_id, type, severity, title, detail, part_id, shipment_id, at, dedupe_key)
     SELECT $1, $2, $3, $4, $5, $6, s.shipment_id, $8, $9
       FROM (SELECT 1) one LEFT JOIN shipments s ON s.shipment_id = $7
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND NOT acknowledged DO NOTHING
     RETURNING alert_id`,
    [id, a.type, a.severity, a.title, a.detail, a.partId ?? null, a.shipmentId ?? null, a.at, a.dedupeKey]);
  return res.rows.length > 0;
}

/** Closes the open alert with this key (used when a pending transaction is resolved). */
export async function resolveAlert(q: Queryable, dedupeKey: string, note: string) {
  await q.query('UPDATE alerts SET acknowledged = TRUE, acknowledged_at = now(), resolution_note = $2 WHERE dedupe_key = $1 AND NOT acknowledged', [dedupeKey, note]);
}
