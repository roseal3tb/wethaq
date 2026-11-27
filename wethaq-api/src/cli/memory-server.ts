/**
 * Self-contained API for quick demonstrations and the live-mode browser tests: an in-memory
 * PostgreSQL (PGlite), the local development ledger and freshly seeded data. Nothing is saved.
 * Needs no Docker. Run with: npm run dev:memory
 */
import '../env.js';
import { createApp } from '../app.js';
import { localLedger } from '../ledger/local.js';
import { seed } from '../seed.js';
import { testDb } from '../../test/helpers.js';

const port = Number(process.env.PORT || 4000);
const db = await testDb();
const ledger = localLedger(db);
await seed(db, ledger, { password: process.env.DEMO_PASSWORD || 'demo' });
createApp({ db, ledger, config: { jwtSecret: process.env.JWT_SECRET || 'wethaq-memory-secret', jwtTtl: '8h', demoRoleSwitch: true } })
  .listen(port, '127.0.0.1', () => console.log(`Wethaq API (in-memory database, local development ledger) on http://127.0.0.1:${port}/api`));
