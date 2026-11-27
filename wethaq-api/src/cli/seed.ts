import '../env.js';
import { loadConfig } from '../config.js';
import { postgres } from '../db.js';
import { createLedger } from '../ledger/index.js';
import { seed } from '../seed.js';

const config = loadConfig();
const db = postgres(config.databaseUrl);
const ledger = await createLedger(config, db);
const password = process.env.DEMO_PASSWORD || 'demo';
if (!process.env.DEMO_PASSWORD) console.log('DEMO_PASSWORD is not set: demonstration accounts use the password "demo"');
try {
  await seed(db, ledger, { password, reset: process.argv.includes('--reset'), log: console.log });
} finally { await ledger.close(); await db.close(); }
