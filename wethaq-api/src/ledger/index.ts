import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { fabricLedger } from './fabric.js';
import { localLedger } from './local.js';
import type { Ledger } from './types.js';

export async function createLedger(config: Config, db: Db, env: NodeJS.ProcessEnv = process.env): Promise<Ledger> {
  if (config.ledgerMode === 'local') return localLedger(db);
  const testNetworkPath = path.resolve(env.FABRIC_TEST_NETWORK || '../fabric/fabric-samples/test-network');
  try {
    return await fabricLedger({
      testNetworkPath,
      channel: env.FABRIC_CHANNEL || 'wethaq',
      chaincode: env.FABRIC_CHAINCODE || 'wethaq',
      org1Endpoint: env.FABRIC_ORG1_ENDPOINT || 'localhost:7051',
      org2Endpoint: env.FABRIC_ORG2_ENDPOINT || 'localhost:9051'
    });
  } catch (err) {
    throw new Error(`Could not connect to Fabric using the test network at ${testNetworkPath}. Is the network running (npm run fabric:up in the fabric folder)? ${(err as Error).message}`);
  }
}
