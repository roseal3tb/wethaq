/**
 * First start of a real installation: the reference data and one administrator, with no demonstration
 * accounts and no demonstration shipments. The administrator gets a one-time temporary password, which
 * must be replaced at first sign-in and stops working after `hours` hours.
 */
import type { Db } from '../db.js';
import { insertReferenceData } from '../seed.js';
import { audit } from './audit.js';
import { addUser } from './users.js';

export class AlreadyInitialised extends Error {}

export async function bootstrap(db: Db, { name, email, catalogue = false, hours = 24 }: { name: string; email: string; catalogue?: boolean; hours?: number }) {
  const used = (await db.query<{ n: number }>('SELECT (SELECT count(*) FROM users)::int + (SELECT count(*) FROM organizations)::int AS n')).rows[0].n;
  if (used > 0) throw new AlreadyInitialised('The database already has users or organizations: bootstrap only runs on an empty, migrated database');
  await db.transaction(q => insertReferenceData(q, { catalogue }));
  const admin = await addUser(db, { name, email, role: 'Admin', org: 'System Administration' }, hours);
  await audit(db, { action: 'system.bootstrap', outcome: 'ok', userId: admin.id, org: admin.org, target: admin.id, detail: { catalogue } });
  return admin;
}
