import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { localLedger } from './local.js';
import type { Ledger } from './types.js';

export async function createLedger(config: Config, db: Db): Promise<Ledger> {
  if (config.ledgerMode === 'local') return localLedger(db);
  throw new Error('LEDGER_MODE=fabric is added in the Fabric stage of the backend; use LEDGER_MODE=local for now');
}
