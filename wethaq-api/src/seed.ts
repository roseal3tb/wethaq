/**
 * Seeds the database with the same synthetic demonstration data as the dashboard (src/data/mock.ts):
 * 60 parts, 180 inventory positions, 8 users and 48 shipments. Shipment history is replayed through
 * the ledger, so every seeded transaction is a real ledger transaction with its own id and block.
 */
import type { Db } from './db.js';
import type { Ledger } from './ledger/types.js';
import { findUser, hashPassword, ROLES } from './auth.js';
import { DEMO_ACCOUNTS } from './app.js';
import { LOCATIONS, locationId } from './services/common.js';
import { createShipment, invalidDemo, operate, DEMO_SCENARIOS } from './services/shipments.js';
import { BASE_INVENTORY, INITIAL_USERS, PARTS, initialData } from '../../src/data/mock.js';

const ORGS = [
  ['ORG-LC', 'Logistics Command', null], ['ORG-1', 'Org1 (Issuing)', 'Org1MSP'],
  ['ORG-2', 'Org2 (Receiving)', 'Org2MSP'], ['ORG-ADMIN', 'System Administration', null]
] as const;

const TABLES = ['alerts', 'ledger_records', 'shipment_events', 'shipments', 'forecasts', 'inventory', 'users', 'parts', 'locations', 'roles', 'organizations', 'local_ledger_blocks', 'local_ledger_state'];

export async function seed(db: Db, ledger: Ledger, { password, reset = false, log = () => undefined }: { password: string; reset?: boolean; log?: (s: string) => void }) {
  if (reset) {
    if (ledger.kind === 'fabric') log('Note: --reset clears PostgreSQL only. Restart the Fabric network to clear the ledger.');
    await db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  }
  if ((await db.query('SELECT 1 FROM users LIMIT 1')).rows.length) { log('Database already seeded (use --reset to start again)'); return false; }

  const demo = initialData();
  const hash = await hashPassword(password);
  // The first account of each role uses the short demonstration email shown on the sign-in page.
  const demoEmails = Object.fromEntries(ROLES.map((role, i) => [INITIAL_USERS[i].id, DEMO_ACCOUNTS[role]]));
  const orgId = (name: string) => ORGS.find(o => o[1] === name)![0];

  await db.transaction(async q => {
    for (const [id, name, msp] of ORGS) await q.query('INSERT INTO organizations (org_id, name, msp_id) VALUES ($1, $2, $3)', [id, name, msp]);
    for (const role of ROLES) await q.query('INSERT INTO roles (role_id, name) VALUES ($1, $2)', [`ROLE-${role.toUpperCase()}`, role]);
    for (const u of INITIAL_USERS) {
      await q.query('INSERT INTO users (user_id, name, email, password_hash, role_id, org_id, active, last_seen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [u.id, u.name, demoEmails[u.id] ?? u.email, hash, `ROLE-${u.role.toUpperCase()}`, orgId(u.org), u.active, u.lastSeen]);
    }
    for (const l of LOCATIONS) await q.query('INSERT INTO locations (location_id, name) VALUES ($1, $2)', [l.id, l.name]);
    for (const p of PARTS) await q.query('INSERT INTO parts (part_id, name, demand_class, criticality, unit) VALUES ($1, $2, $3, $4, $5)', [p.id, p.name, p.demandClass, p.criticality, p.unit]);
    for (const r of BASE_INVENTORY) {
      await q.query('INSERT INTO inventory (part_id, location_id, on_hand, reorder_point, safety_stock, lead_days, monthly_demand) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [r.partId, locationId(r.location), r.onHand, r.reorderPoint, r.safetyStock, r.leadDays, r.monthlyDemand]);
    }
  });
  log(`Seeded ${ORGS.length} organizations, ${INITIAL_USERS.length} users, ${PARTS.length} parts and ${BASE_INVENTORY.length} inventory positions`);

  const [planner, dispatcher, receiver, admin] = await Promise.all(ROLES.map(role => findUser(db, 'email', DEMO_ACCOUNTS[role]).then(u => u!)));
  // Replay each shipment's history through the ledger; shipments run in parallel because Fabric
  // commits in blocks, and each shipment's own operations stay in order.
  let replayed = 0;
  const replay = async (s: (typeof demo.shipments)[number]) => {
    const { id } = await createShipment(db, ledger, planner, { partId: s.partId, location: s.to, qty: s.quantity, month: s.forecastMonth, note: s.note }, s.id);
    // Keep the seeded baseline apart from shipments created later (the dashboard treats them differently).
    await db.query('UPDATE shipments SET created_live = FALSE, requested_at = $2, expected_at = $3 WHERE shipment_id = $1', [id, s.requestedAt, s.expectedAt]);
    // The baseline inventory already includes these historical movements, so they do not change stock levels.
    const steps: [Parameters<typeof operate>[3], typeof dispatcher, number][] = [];
    if (s.status !== 'Requested') steps.push(['dispatch', dispatcher, s.dispatchedQty!]);
    if (s.status === 'In Transit' || s.status === 'Received') steps.push(['transit', dispatcher, 0]);
    if (s.status === 'Received') steps.push(['receive', receiver, s.receivedQty!]);
    for (const [op, user, qty] of steps) {
      const result = await operate(db, ledger, user, op, id, qty, 'Seeded demonstration history', { adjustInventory: false });
      if (!result.passed) throw new Error(`Seeding ${id} ${op} was rejected: ${result.reason}`);
    }
    replayed += 1 + steps.length;
  };
  const queue = [...demo.shipments];
  await Promise.all(Array.from({ length: ledger.kind === 'fabric' ? 12 : 1 }, async () => { for (let s = queue.shift(); s; s = queue.shift()) await replay(s); }));
  log(`Replayed ${demo.shipments.length} shipments through the ${ledger.kind} ledger (${replayed} transactions)`);

  for (const scenario of DEMO_SCENARIOS) await invalidDemo(db, ledger, admin, scenario);
  log(`Recorded ${DEMO_SCENARIOS.length} rejected demonstration attempts`);

  // Shortage and delay alerts from the dashboard's demonstration data (discrepancies come from the replay).
  for (const a of demo.alerts.filter(a => a.type === 'Shortage' || a.type === 'Delay')) {
    await db.query('INSERT INTO alerts (alert_id, type, severity, title, detail, part_id, shipment_id, at, acknowledged) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [a.id, a.type, a.severity, a.title, a.detail, a.partId ?? null, a.shipmentId ?? null, a.at, a.acknowledged]);
  }
  return true;
}
