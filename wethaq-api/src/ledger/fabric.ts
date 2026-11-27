import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers, type Contract, type Gateway } from '@hyperledger/fabric-gateway';
import type { LedgerRecord, LedgerShipment } from '../../../chaincode/shipment/src/rules.js';
import type { Ledger, LedgerOperation, LedgerOutcome, OrgMsp } from './types.js';

export interface FabricConfig {
  /** Path to fabric-samples/test-network (holds the generated crypto material). */
  testNetworkPath: string;
  channel: string;
  chaincode: string;
  /** Peer endpoints on the host; the test network publishes Org1 on 7051 and Org2 on 9051. */
  org1Endpoint: string;
  org2Endpoint: string;
}

const ORGS = {
  Org1MSP: { domain: 'org1.example.com', endpoint: 'org1Endpoint' },
  Org2MSP: { domain: 'org2.example.com', endpoint: 'org2Endpoint' }
} as const;

const FUNCTION: Record<LedgerOperation, string> = { dispatch: 'Dispatch', transit: 'MarkInTransit', receive: 'Receive' };
const decoder = new TextDecoder();

async function connectOrg(cfg: FabricConfig, msp: OrgMsp): Promise<{ gateway: Gateway; client: grpc.Client; contract: Contract }> {
  const { domain, endpoint } = ORGS[msp];
  const orgDir = path.join(cfg.testNetworkPath, 'organizations', 'peerOrganizations', domain);
  const userDir = path.join(orgDir, 'users', `User1@${domain}`, 'msp');
  const tlsCert = await readFile(path.join(orgDir, 'peers', `peer0.${domain}`, 'tls', 'ca.crt'));
  const credentials = await readFile(path.join(userDir, 'signcerts', (await readdir(path.join(userDir, 'signcerts')))[0]));
  const keyFile = (await readdir(path.join(userDir, 'keystore')))[0];
  const privateKey = createPrivateKey(await readFile(path.join(userDir, 'keystore', keyFile)));
  const client = new grpc.Client(cfg[endpoint], grpc.credentials.createSsl(tlsCert), { 'grpc.ssl_target_name_override': `peer0.${domain}` });
  const gateway = connect({
    client,
    identity: { mspId: msp, credentials },
    signer: signers.newPrivateKeySigner(privateKey),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
    submitOptions: () => ({ deadline: Date.now() + 5_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60_000 })
  });
  return { gateway, client, contract: gateway.getNetwork(cfg.channel).getContract(cfg.chaincode) };
}

/**
 * Hyperledger Fabric ledger (LEDGER_MODE=fabric), through the Fabric Gateway SDK.
 * The API holds one identity per peer organization (User1 of Org1 and of Org2 in the test network)
 * and submits each operation as the organization of the signed-in user. The chaincode's endorsement
 * policy requires both organizations' peers to endorse every transaction.
 */
export async function fabricLedger(cfg: FabricConfig): Promise<Ledger> {
  const orgs = { Org1MSP: await connectOrg(cfg, 'Org1MSP'), Org2MSP: await connectOrg(cfg, 'Org2MSP') };

  async function submit(msp: OrgMsp, fn: string, args: string[]): Promise<LedgerOutcome> {
    const commit = await orgs[msp].contract.submitAsync(fn, { arguments: args });
    const status = await commit.getStatus();
    if (!status.successful) throw new Error(`Fabric did not commit transaction ${status.transactionId} (validation code ${status.code})`);
    const result = JSON.parse(decoder.decode(commit.getResult())) as { passed: boolean; record: LedgerRecord; shipment?: LedgerShipment; failedRule?: LedgerOutcome['failedRule']; failure?: string; reason?: string };
    return { ...result, txId: status.transactionId, block: Number(status.blockNumber), timestamp: result.record.timestamp };
  }

  return {
    kind: 'fabric',
    registerRequest: ({ shipmentId, partId, requestedQty }) => submit('Org1MSP', 'RegisterRequest', [shipmentId, partId, String(requestedQty)]),
    submit: ({ operation, shipmentId, qty, org }) => submit(org, FUNCTION[operation], operation === 'transit' ? [shipmentId] : [shipmentId, String(qty)]),
    async read(shipmentId) {
      const text = decoder.decode(await orgs.Org1MSP.contract.evaluateTransaction('ReadShipment', shipmentId));
      return text ? JSON.parse(text) as LedgerShipment : null;
    },
    async history(shipmentId) {
      return JSON.parse(decoder.decode(await orgs.Org1MSP.contract.evaluateTransaction('GetHistory', shipmentId))) as LedgerRecord[];
    },
    async close() {
      for (const o of Object.values(orgs)) { o.gateway.close(); o.client.close(); }
    }
  };
}
