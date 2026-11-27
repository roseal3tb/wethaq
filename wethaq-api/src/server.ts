import './env.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { postgres } from './db.js';
import { createLedger } from './ledger/index.js';

const config = loadConfig();
const db = postgres(config.databaseUrl);
const ledger = await createLedger(config, db);
const app = createApp({ db, ledger, config });
const server = app.listen(config.port, () => {
  console.log(`Wethaq API listening on http://127.0.0.1:${config.port}/api (ledger: ${ledger.kind})`);
  if (ledger.kind === 'local') console.log('Note: the local development ledger is in use; records are not written to Hyperledger Fabric.');
});
const shutdown = () => server.close(async () => { await app.sync.stop(); await ledger.close(); await db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
