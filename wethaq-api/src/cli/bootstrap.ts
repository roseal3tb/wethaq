/**
 * npm run bootstrap -- --admin-email <email> --admin-name "<name>" [--demo-catalogue]
 *
 * Prepares an empty, migrated database for a real installation: organizations, roles, storage locations
 * and one administrator. It creates no demonstration accounts or shipments. The administrator's temporary
 * password is printed once; it must be changed at first sign-in. --demo-catalogue also loads the
 * synthetic parts catalogue and baseline inventory of the demonstration (for trials only).
 */
import '../env.js';
import { loadConfig } from '../config.js';
import { postgres } from '../db.js';
import { AlreadyInitialised, bootstrap } from '../services/bootstrap.js';
import { HttpError } from '../services/common.js';

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const email = value('--admin-email');
const name = value('--admin-name');
if (!email || !name) {
  console.error('Usage: npm run bootstrap -- --admin-email <email> --admin-name "<name>" [--demo-catalogue]');
  process.exit(2);
}
const config = loadConfig();
const db = postgres(config.databaseUrl);
try {
  const admin = await bootstrap(db, { name, email, catalogue: args.includes('--demo-catalogue'), hours: config.tempPasswordHours });
  console.log(`Created the reference data and the administrator ${admin.email} (${admin.id}).`);
  console.log(`Temporary password (shown once, valid for ${config.tempPasswordHours} hours, must be changed at first sign-in):`);
  console.log(admin.temporaryPassword);
} catch (err) {
  if (err instanceof AlreadyInitialised || err instanceof HttpError) { console.error(err.message); process.exitCode = 1; } else throw err;
} finally { await db.close(); }
