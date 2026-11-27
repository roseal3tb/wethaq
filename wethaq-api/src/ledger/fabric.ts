import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'node:events';
import { connect, hash, signers, type ChaincodeEvent, type CloseableAsyncIterable, type Contract, type Gateway, type Network } from '@hyperledger/fabric-gateway';
import type { LedgerRecord, LedgerShipment } from '../../../chaincode/shipment/src/rules.js';
import type { Ledger, LedgerCommitEvent, LedgerOperation, LedgerOutcome, OrgMsp } from './types.js';

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

async function connectOrg(cfg: FabricConfig, msp: OrgMsp): Promise<{ gateway: Gateway; client: grpc.Client; network: Network; contract: Contract }> {
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
  const network = gateway.getNetwork(cfg.channel);
  return { gateway, client, network, contract: network.getContract(cfg.chaincode) };
}

/**
 * Hyperledger Fabric ledger (LEDGER_MODE=fabric), through the Fabric Gateway SDK.
 * The API holds one identity per peer organization (User1 of Org1 and of Org2 in the test network)
 * and submits each operation as the organization of the signed-in user. The chaincode's endorsement
 * policy requires both organizations' peers to endorse every transaction.
 */
export async function fabricLedger(cfg: FabricConfig): Promise<Ledger> {
  const orgs = { Org1MSP: await connectOrg(cfg, 'Org1MSP'), Org2MSP: await connectOrg(cfg, 'Org2MSP') };
  const events = new EventEmitter();
  events.setMaxListeners(0);
  let closed = false;
  let stream: CloseableAsyncIterable<ChaincodeEvent> | undefined;

  /**
   * Listens to the chaincode events of every committed block (through Org1's peer), so the API hears
   * about transactions from any client of the network, not only its own. The stream resumes after the
   * last block it delivered if the connection drops.
   */
  async function listen() {
    let nextBlock: bigint | undefined;
    while (!closed) {
      try {
        stream = await orgs.Org1MSP.network.getChaincodeEvents(cfg.chaincode, nextBlock === undefined ? undefined : { startBlock: nextBlock });
        for await (const event of stream) {
          nextBlock = event.blockNumber + 1n;
          let record: LedgerRecord;
          try { record = JSON.parse(decoder.decode(event.payload)) as LedgerRecord; } catch { continue; }
          events.emit('commit', { name: event.eventName, txId: event.transactionId, block: Number(event.blockNumber), record } satisfies LedgerCommitEvent);
        }
      } catch (err) {
        if (closed) return;
        console.warn(`Fabric event stream interrupted (${(err as Error).message}); reconnecting in 3 seconds`);
      } finally {
        stream?.close();
      }
      if (!closed) await new Promise(resolve => setTimeout(resolve, 3_000));
    }
  }
  void listen();

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
    onCommit(listener) {
      events.on('commit', listener);
      return () => { events.off('commit', listener); };
    },
    async close() {
      closed = true;
      stream?.close();
      events.removeAllListeners();
      for (const o of Object.values(orgs)) { o.gateway.close(); o.client.close(); }
    }
  };
}
