/**
 * Paginated, filtered lists of the PostgreSQL reporting copy, and the traceability view of one shipment.
 * /state still returns everything the dashboard needs at once; these endpoints let other clients and larger
 * data sets read a page at a time. Every filter is validated and passed to SQL as a parameter.
 */
import type { Queryable } from '../db.js';
import type { Ledger } from '../ledger/types.js';
import { HttpError, LOCATIONS, locationId } from './common.js';
import { ALERTS_SQL, EVENTS_SQL, SHIPMENTS_SQL, mapAlert, mapEvent, mapRecord, mapShipment } from './state.js';
import { LEDGER_STATUSES } from '../../../chaincode/shipment/src/rules.js';

type Query = Record<string, unknown>;

export interface Page<T> { items: T[]; total: number; limit: number; offset: number; }

/** limit 1–200 (default 50) and offset 0 or more. */
export function pageParams(query: Query, maxLimit = 200) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new HttpError(400, `limit must be a whole number from 1 to ${maxLimit}`);
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new HttpError(400, 'offset must be a whole number of 0 or more');
  return { limit, offset };
}

function one(query: Query, name: string, allowed?: readonly string[], pattern?: RegExp): string | undefined {
  const value = query[name];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be given once`);
  if (allowed && !allowed.includes(value)) throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}`);
  if (pattern && !pattern.test(value)) throw new HttpError(400, `Invalid ${name}`);
  return value;
}

function date(query: Query, name: string): string | undefined {
  const value = one(query, name);
  if (value === undefined) return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new HttpError(400, `${name} must be a date or date-time (ISO 8601)`);
  return new Date(t).toISOString();
}

/** Collects WHERE conditions with numbered parameters. */
class Where {
  readonly params: unknown[] = [];
  private readonly parts: string[] = [];
  add(sql: (p: string) => string, value: unknown) {
    if (value === undefined) return this;
    this.params.push(value);
    this.parts.push(sql(`$${this.params.length}`));
    return this;
  }
  get sql() { return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : ''; }
  next() { return `$${this.params.length + 1}`; }
}

const SHIPMENT_ID = /^[A-Za-z0-9-]{1,64}$/;
const STATUSES = LEDGER_STATUSES;

async function page<T>(q: Queryable, select: string, count: string, where: Where, order: string, { limit, offset }: { limit: number; offset: number }, map: (row: Record<string, any>) => T): Promise<Page<T>> {
  const l = where.next();
  const o = `$${where.params.length + 2}`;
  const [rows, total] = await Promise.all([
    q.query<Record<string, any>>(`${select} ${where.sql} ORDER BY ${order} LIMIT ${l} OFFSET ${o}`, [...where.params, limit, offset]),
    q.query<{ n: number }>(`${count} ${where.sql}`, where.params)
  ]);
  return { items: rows.rows.map(map), total: Number(total.rows[0].n), limit, offset };
}

/** GET /shipments: status, partId, location (name or id), ledgerState; newest first. */
export async function listShipments(q: Queryable, query: Query) {
  const location = one(query, 'location');
  const locId = location === undefined ? undefined : LOCATIONS.some(l => l.id === location) ? location : locationId(location);
  if (location !== undefined && !locId) throw new HttpError(400, `location must be one of: ${LOCATIONS.map(l => l.name).join(', ')}`);
  const where = new Where()
    .add(p => `s.status = ${p}`, one(query, 'status', STATUSES))
    .add(p => `s.part_id = ${p}`, one(query, 'partId', undefined, /^SP-\d{3}$/))
    .add(p => `s.to_location = ${p}`, locId)
    .add(p => `s.ledger_state = ${p}`, one(query, 'ledgerState', ['pending', 'confirmed', 'failed']));
  const result = await page(q, SHIPMENTS_SQL, 'SELECT count(*)::int AS n FROM shipments s', where, 's.requested_at DESC, s.shipment_id DESC', pageParams(query), row => row);
  // The timeline of the shipments on this page only.
  const ids = result.items.map(s => s.shipment_id as string);
  const events = ids.length ? (await q.query<Record<string, any>>(`${EVENTS_SQL} WHERE e.shipment_id = ANY($1) ORDER BY e.time, e.event_id`, [ids])).rows : [];
  return { ...result, items: result.items.map(s => mapShipment(s, events.filter(e => e.shipment_id === s.shipment_id).map(mapEvent))) };
}

/** GET /ledger/records: the reporting copy of ledger records and application-level rejections, newest first. */
export async function listLedgerRecords(q: Queryable, query: Query) {
  const where = new Where()
    .add(p => `shipment_id = ${p}`, one(query, 'shipmentId', undefined, SHIPMENT_ID))
    .add(p => `type = ${p}`, one(query, 'type', ['REQUEST', 'DISPATCH', 'STATUS_CHANGE', 'RECEIPT', 'PARTIAL_RECEIPT', 'CANCELLATION', 'RETURN', 'ATTEMPT']))
    .add(p => `status = ${p}`, one(query, 'status', ['Committed', 'Rejected']))
    .add(p => `source = ${p}`, one(query, 'source', ['chaincode', 'application']))
    .add(p => `timestamp >= ${p}`, date(query, 'from'))
    .add(p => `timestamp < ${p}`, date(query, 'to'));
  return page(q, 'SELECT * FROM ledger_records', 'SELECT count(*)::int AS n FROM ledger_records', where, 'timestamp DESC, record_id DESC', pageParams(query), mapRecord);
}

/** GET /alerts: acknowledged=true|false, type, severity, shipmentId, partId; newest first. */
export async function listAlerts(q: Queryable, query: Query) {
  const ack = one(query, 'acknowledged', ['true', 'false']);
  const where = new Where()
    .add(p => `a.acknowledged = ${p}`, ack === undefined ? undefined : ack === 'true')
    .add(p => `a.type = ${p}`, one(query, 'type', ['Shortage', 'Discrepancy', 'Delay', 'Rejected attempt', 'Ledger sync', 'Pending transaction']))
    .add(p => `a.severity = ${p}`, one(query, 'severity', ['Critical', 'High', 'Medium', 'Low']))
    .add(p => `a.shipment_id = ${p}`, one(query, 'shipmentId', undefined, SHIPMENT_ID))
    .add(p => `a.part_id = ${p}`, one(query, 'partId', undefined, /^SP-\d{3}$/));
  return page(q, ALERTS_SQL, 'SELECT count(*)::int AS n FROM alerts a', where, 'a.at DESC, a.alert_id DESC', pageParams(query), mapAlert);
}

/**
 * GET /admin/audit: newest first, filtered by action, outcome, userId and target; `before` is the id of the last
 * entry of the previous page (keyset pagination, so new entries do not shift the pages).
 */
export async function listAudit(q: Queryable, query: Query) {
  const before = query.before === undefined ? undefined : Number(query.before);
  if (before !== undefined && (!Number.isInteger(before) || before < 1)) throw new HttpError(400, 'before must be an audit entry id');
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, 'limit must be a whole number from 1 to 500');
  const where = new Where()
    .add(p => `action = ${p}`, one(query, 'action', undefined, /^[a-z_.]{1,64}$/))
    .add(p => `outcome = ${p}`, one(query, 'outcome', ['ok', 'denied', 'rejected', 'failed', 'pending']))
    .add(p => `user_id = ${p}`, one(query, 'userId', undefined, /^[A-Za-z0-9._-]{1,64}$/))
    .add(p => `target = ${p}`, one(query, 'target', undefined, /^[A-Za-z0-9._@-]{1,128}$/))
    .add(p => `audit_id < ${p}`, before);
  const rows = await q.query(`SELECT audit_id AS id, at, request_id AS "requestId", user_id AS "userId", org, action, target, outcome, detail FROM audit_log ${where.sql} ORDER BY audit_id DESC LIMIT ${where.next()}`, [...where.params, Math.min(500, limit)]);
  return rows.rows;
}

/**
 * GET /shipments/:id: the full traceability of one shipment from PostgreSQL (the request, its timeline, every
 * ledger record and rejected attempt, its alerts and the ledger operations submitted for it) and, unless
 * ledger=false, the shipment's history read from the ledger itself.
 */
export async function shipmentTrace(q: Queryable, ledger: Ledger, id: string, query: Query) {
  if (!SHIPMENT_ID.test(id)) throw new HttpError(400, 'Invalid shipment reference');
  const row = (await q.query<Record<string, any>>(`${SHIPMENTS_SQL} WHERE s.shipment_id = $1`, [id])).rows[0];
  if (!row) throw new HttpError(404, 'Shipment not found');
  const [events, records, alerts, operations] = await Promise.all([
    q.query<Record<string, any>>(`${EVENTS_SQL} WHERE e.shipment_id = $1 ORDER BY e.time, e.event_id`, [id]),
    q.query<Record<string, any>>('SELECT * FROM ledger_records WHERE shipment_id = $1 ORDER BY timestamp, record_id', [id]),
    q.query<Record<string, any>>(`${ALERTS_SQL} WHERE a.shipment_id = $1 ORDER BY a.at`, [id]),
    q.query<Record<string, any>>('SELECT operation_id, kind, user_name, org, quantity, state, failure, block, created_at, applied_at FROM ledger_operations WHERE shipment_id = $1 ORDER BY created_at', [id])
  ]);
  let onLedger: { history: unknown[] } | { error: string } | undefined;
  if (one(query, 'ledger', ['true', 'false']) !== 'false') {
    onLedger = await ledger.history(id).then(history => ({ history }), () => ({ error: 'The ledger could not be reached' }));
  }
  return {
    shipment: mapShipment(row, events.rows.map(mapEvent)),
    records: records.rows.map(mapRecord),
    alerts: alerts.rows.map(mapAlert),
    operations: operations.rows.map(o => ({
      operationId: o.operation_id, kind: o.kind, user: o.user_name, org: o.org, quantity: o.quantity, state: o.state, failure: o.failure ?? undefined,
      block: o.block ?? undefined, createdAt: new Date(o.created_at).toISOString(), appliedAt: o.applied_at ? new Date(o.applied_at).toISOString() : undefined
    })),
    ledger: { kind: ledger.kind, ...onLedger }
  };
}
