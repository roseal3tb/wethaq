import type { Queryable } from '../db.js';
import type { ApiUser } from '../auth.js';
import { locationName } from './common.js';

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : undefined);
const opt = <T>(v: T | null | undefined) => (v === null ? undefined : v);

/** Timeline entries with the actor's name and organization (shipment_events joined with users and ledger_records). */
export const EVENTS_SQL = `SELECT e.*, COALESCE(u.name, r.user_name, 'Ledger client') AS actor, COALESCE(o.name, r.org, 'Ledger network') AS org FROM shipment_events e LEFT JOIN users u ON u.user_id = e.actor_id LEFT JOIN organizations o ON o.org_id = u.org_id LEFT JOIN ledger_records r ON r.record_id = e.tx_id`;
export const SHIPMENTS_SQL = 'SELECT s.*, u.name AS requested_by_name FROM shipments s JOIN users u ON u.user_id = s.requested_by';
export const ALERTS_SQL = 'SELECT a.*, u.name AS resolved_by FROM alerts a LEFT JOIN users u ON u.user_id = a.acknowledged_by';

/** Row mappers shared by /state and the list endpoints (the dashboard's types in src/types.ts). */
export const mapEvent = (e: Record<string, any>) => ({ status: e.status, time: iso(e.time), actor: e.actor, org: e.org, txId: opt(e.tx_id), note: opt(e.note) });
export const mapShipment = (s: Record<string, any>, events: ReturnType<typeof mapEvent>[]) => ({
  id: s.shipment_id, partId: s.part_id, quantity: s.requested_qty, dispatchedQty: opt(s.dispatched_qty), receivedQty: opt(s.received_qty), returnedQty: opt(s.returned_qty),
  from: s.from_location, to: locationName(s.to_location), status: s.status, requestedBy: s.requested_by_name, requestedAt: iso(s.requested_at),
  forecastMonth: s.forecast_month, note: s.review_note, expectedAt: iso(s.expected_at), recommendationId: opt(s.recommendation_id),
  createdInSession: s.created_live, ledgerState: s.ledger_state, lastTxId: opt(s.last_tx_id), events
});
export const mapRecord = (t: Record<string, any>) => ({
  id: t.record_id, type: t.type, shipmentId: t.shipment_id, partId: t.part_id, quantity: t.quantity, org: t.org, user: t.user_name,
  timestamp: iso(t.timestamp), block: opt(t.block), hash: t.tx_id ?? '', status: t.status, reason: opt(t.reason), failedRule: opt(t.failed_rule),
  fromStatus: opt(t.from_status), toStatus: opt(t.to_status), source: t.source
});
export const mapAlert = (a: Record<string, any>) => ({
  id: a.alert_id, severity: a.severity, type: a.type, title: a.title, detail: a.detail, partId: opt(a.part_id), shipmentId: opt(a.shipment_id),
  at: iso(a.at), acknowledged: a.acknowledged, resolutionNote: opt(a.resolution_note), resolvedBy: opt(a.resolved_by)
});

/** Loads the dashboard's AppData (src/types.ts) from the reporting database. */
export async function loadState(q: Queryable, user: ApiUser) {
  const [shipments, events, records, alerts, users] = await Promise.all([
    q.query<Record<string, any>>(`${SHIPMENTS_SQL} ORDER BY s.requested_at DESC, s.shipment_id DESC`),
    q.query<Record<string, any>>(`${EVENTS_SQL} ORDER BY e.time, e.event_id`),
    // REQUEST records stay in the database and on the ledger; the dashboard's ledger view lists operations only.
    q.query<Record<string, any>>(`SELECT * FROM ledger_records WHERE type <> 'REQUEST' ORDER BY timestamp DESC, record_id DESC`),
    q.query<Record<string, any>>(`${ALERTS_SQL} ORDER BY a.at DESC`),
    user.role === 'Admin'
      ? q.query<Record<string, any>>(`SELECT u.user_id, u.name, u.email, r.name AS role, o.name AS org, u.active, u.last_seen, u.must_change_password, u.password_expires_at FROM users u JOIN roles r ON r.role_id = u.role_id JOIN organizations o ON o.org_id = u.org_id ORDER BY u.user_id`)
      : Promise.resolve({ rows: [{ user_id: user.id, name: user.name, email: user.email, role: user.role, org: user.org, active: user.active, last_seen: user.lastSeen, must_change_password: user.mustChangePassword, password_expires_at: user.passwordExpiresAt }] as Record<string, any>[] })
  ]);
  const byShipment = new Map<string, ReturnType<typeof mapEvent>[]>();
  for (const e of events.rows) {
    const list = byShipment.get(e.shipment_id) ?? [];
    list.push(mapEvent(e));
    byShipment.set(e.shipment_id, list);
  }
  return {
    shipments: shipments.rows.map(s => mapShipment(s, byShipment.get(s.shipment_id) ?? [])),
    transactions: records.rows.map(mapRecord),
    alerts: alerts.rows.map(mapAlert),
    users: users.rows.map(u => ({ id: u.user_id, name: u.name, email: u.email, role: u.role, org: u.org, active: u.active, lastSeen: iso(u.last_seen), mustChangePassword: u.must_change_password, passwordExpiresAt: u.password_expires_at ? iso(u.password_expires_at) : null }))
  };
}

export async function loadInventory(q: Queryable) {
  const rows = (await q.query<Record<string, any>>('SELECT * FROM inventory ORDER BY part_id, location_id')).rows;
  return rows.map(r => ({ partId: r.part_id, location: locationName(r.location_id), onHand: r.on_hand, reorderPoint: r.reorder_point, safetyStock: r.safety_stock, leadDays: r.lead_days, monthlyDemand: r.monthly_demand, updatedAt: iso(r.updated_at) }));
}
