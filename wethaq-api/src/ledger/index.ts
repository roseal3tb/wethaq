import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { fabricLedger } from './fabric.js';
import { localLedger } from './local.js';
import type { Ledger } from './types.js';

/**
 * LEDGER_MODE=local uses the development ledger in PostgreSQL; LEDGER_MODE=fabric connects to Fabric.
 * Fabric mode never falls back to the local ledger: if it cannot connect, the API does not start.
 */
export async function createLedger(config: Config, db: Db, env: NodeJS.ProcessEnv = process.env): Promise<Ledger> {
  if (config.ledgerMode === 'local') return localLedger(db);
  const testNetworkPath = path.resolve(env.FABRIC_TEST_NETWORK || '../fabric/fabric-samples/test-network');
  const identityDir = path.resolve(env.FABRIC_IDENTITY_DIR || '../fabric/identities');
  const ms = (name: string) => env[name] ? Number(env[name]) : undefined;
  try {
    return await fabricLedger({
      testNetworkPath,
      identityDir,
      appUser: env.FABRIC_APP_USER || 'wethaq-app',
      channel: env.FABRIC_CHANNEL || 'wethaq',
      chaincode: env.FABRIC_CHAINCODE || 'wethaq',
      org1Endpoint: env.FABRIC_ORG1_ENDPOINT || 'localhost:7051',
      org2Endpoint: env.FABRIC_ORG2_ENDPOINT || 'localhost:9051',
      timeouts: { evaluate: ms('FABRIC_EVALUATE_TIMEOUT_MS'), endorse: ms('FABRIC_ENDORSE_TIMEOUT_MS'), submit: ms('FABRIC_SUBMIT_TIMEOUT_MS'), commitStatus: ms('FABRIC_COMMIT_TIMEOUT_MS') }
    });
  } catch (err) {
    throw new Error(`LEDGER_MODE=fabric but the API could not connect to Fabric (test network ${testNetworkPath}, identities ${identityDir}). Is the network running (./fabric/up.sh)? ${(err as Error).message}`);
  }
}
