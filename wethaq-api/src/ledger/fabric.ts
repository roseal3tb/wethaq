import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import {
  connect, EndorseError, GatewayError, hash, signers, SubmitError, CommitStatusError,
  type ChaincodeEvent, type CloseableAsyncIterable, type Contract, type Gateway, type Network
} from '@hyperledger/fabric-gateway';
import { common, peer } from '@hyperledger/fabric-protos';
import { NO_QUANTITY, type LedgerRecord, type LedgerShipment } from '../../../chaincode/shipment/src/rules.js';
import { logger } from '../logger.js';
import { LedgerError, type Ledger, type LedgerCommitEvent, type LedgerHealth, type LedgerOperation, type LedgerOutcome, type OrgMsp, type PreparedTransaction, type TransactionStatus, type VerifyOutcome } from './types.js';

export interface FabricConfig {
  /** Path to fabric-samples/test-network (holds the peers' TLS CA certificates). */
  testNetworkPath: string;
  /** Folder with the application identities enrolled from the Fabric CAs (fabric/identities). */
  identityDir: string;
  /** Name of the enrolled application identity (fabric/enroll-identities.sh registers it). */
  appUser: string;
  channel: string;
  chaincode: string;
  /** Peer endpoints on the host; the test network publishes Org1 on 7051 and Org2 on 9051. */
  org1Endpoint: string;
  org2Endpoint: string;
  /** Time limits in milliseconds. */
  timeouts?: { evaluate?: number; endorse?: number; submit?: number; commitStatus?: number };
}

const ORGS = {
  Org1MSP: { domain: 'org1.example.com', endpoint: 'org1Endpoint', dir: 'org1' },
  Org2MSP: { domain: 'org2.example.com', endpoint: 'org2Endpoint', dir: 'org2' }
} as const;

const FUNCTION: Record<LedgerOperation, string> = { dispatch: 'Dispatch', transit: 'MarkInTransit', receive: 'Receive', receivePartial: 'ReceivePartial', cancel: 'Cancel', return: 'Return' };
const decoder = new TextDecoder();
const TX_CODE = Object.fromEntries(Object.entries(peer.TxValidationCode).map(([name, code]) => [code, name])) as Record<number, string>;

interface OrgConnection { gateway: Gateway; client: grpc.Client; network: Network; contract: Contract; identity: { msp: OrgMsp; subject: string; validTo: Date } }

/**
 * Loads an organization's application identity. The API signs with an identity enrolled from the
 * organization's Fabric CA for the application (never an admin identity). The identity is per
 * organization, not per dashboard user: the ledger shows which organization submitted a transaction,
 * and the API's PostgreSQL audit log shows which signed-in user asked for it.
 */
async function loadIdentity(cfg: FabricConfig, msp: OrgMsp) {
  const mspDir = path.join(cfg.identityDir, ORGS[msp].dir, cfg.appUser, 'msp');
  let certPem: Buffer; let keyPem: Buffer;
  try {
    const certFile = (await readdir(path.join(mspDir, 'signcerts')))[0];
    const keyFile = (await readdir(path.join(mspDir, 'keystore')))[0];
    certPem = await readFile(path.join(mspDir, 'signcerts', certFile));
    keyPem = await readFile(path.join(mspDir, 'keystore', keyFile));
  } catch {
    throw new Error(`No ${msp} application identity in ${mspDir}. Run ./fabric/enroll-identities.sh (up.sh does this).`);
  }
  const cert = new X509Certificate(certPem);
  const validTo = new Date(cert.validTo);
  if (validTo.getTime() <= Date.now()) throw new Error(`The ${msp} application certificate expired on ${validTo.toISOString()}. Re-enroll it with ./fabric/enroll-identities.sh after deleting ${path.dirname(mspDir)}.`);
  return { credentials: certPem, privateKey: createPrivateKey(keyPem), subject: cert.subject.replace(/\n/g, ', '), validTo };
}

async function connectOrg(cfg: FabricConfig, msp: OrgMsp): Promise<OrgConnection> {
  const { domain, endpoint } = ORGS[msp];
  // Unset values keep the defaults (a spread would copy undefined over them).
  const t = { evaluate: 5_000, endorse: 15_000, submit: 5_000, commitStatus: 60_000, ...Object.fromEntries(Object.entries(cfg.timeouts ?? {}).filter(([, v]) => Number.isFinite(v) && (v as number) > 0)) };
  const tlsCert = await readFile(path.join(cfg.testNetworkPath, 'organizations', 'peerOrganizations', domain, 'peers', `peer0.${domain}`, 'tls', 'ca.crt'));
  const id = await loadIdentity(cfg, msp);
  // TLS: the peer's certificate is verified against the organization's TLS CA.
  const client = new grpc.Client(cfg[endpoint], grpc.credentials.createSsl(tlsCert), { 'grpc.ssl_target_name_override': `peer0.${domain}` });
  const gateway = connect({
    client,
    identity: { mspId: msp, credentials: id.credentials },
    signer: signers.newPrivateKeySigner(id.privateKey),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + t.evaluate }),
    endorseOptions: () => ({ deadline: Date.now() + t.endorse }),
    submitOptions: () => ({ deadline: Date.now() + t.submit }),
    commitStatusOptions: () => ({ deadline: Date.now() + t.commitStatus })
  });
  const network = gateway.getNetwork(cfg.channel);
  return { gateway, client, network, contract: network.getContract(cfg.chaincode), identity: { msp, subject: id.subject, validTo: id.validTo } };
}

const isUnavailable = (err: unknown) => err instanceof GatewayError && [grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED].includes(err.code);

/**
 * Hyperledger Fabric ledger (LEDGER_MODE=fabric), through the Fabric Gateway SDK.
 * Each operation is signed by the identity of the organization the signed-in user belongs to
 * (Dispatcher → Org1MSP, Receiver → Org2MSP); the chaincode reads the submitter's MSP from the
 * verified client identity, never from an argument. The endorsement policy requires a peer of both
 * organizations to endorse every transaction.
 */
export async function fabricLedger(cfg: FabricConfig): Promise<Ledger> {
  const orgs = { Org1MSP: await connectOrg(cfg, 'Org1MSP'), Org2MSP: await connectOrg(cfg, 'Org2MSP') };
  let closed = false;
  const streams = new Set<CloseableAsyncIterable<ChaincodeEvent>>();
  const qscc = orgs.Org1MSP.network.getContract('qscc');

  /** Endorses, submits and waits for the commit; maps every failure to a LedgerError (Case C). */
  function prepare(msp: OrgMsp, fn: string, args: string[]): PreparedTransaction {
    const proposal = orgs[msp].contract.newProposal(fn, { arguments: args });
    const txId = proposal.getTransactionId();
    return {
      txId,
      async submit(): Promise<LedgerOutcome> {
        let transaction;
        try { transaction = await proposal.endorse(); } catch (err) {
          if (isUnavailable(err)) throw new LedgerError('unavailable', `Fabric peers are not reachable (${(err as Error).message})`, txId);
          const detail = err instanceof EndorseError ? err.details.map(d => d.message).join('; ') || err.message : (err as Error).message;
          throw new LedgerError('endorsement', `The transaction was not endorsed: ${detail}`, txId);
        }
        let commit;
        try { commit = await transaction.submit(); } catch (err) {
          throw new LedgerError('submit', `Submitting to the orderer failed; the outcome is unknown until reconciled (${(err as Error).message})`, txId);
        }
        let status;
        try { status = await commit.getStatus(); } catch (err) {
          if (err instanceof CommitStatusError || isUnavailable(err)) throw new LedgerError('commit_timeout', `No commit status received; the outcome is unknown until reconciled (${(err as Error).message})`, txId);
          throw new LedgerError('commit_timeout', (err as Error).message, txId);
        }
        if (!status.successful) {
          const code = TX_CODE[status.code] ?? String(status.code);
          throw new LedgerError('invalid', `Fabric marked the transaction invalid (${code}); nothing was written`, txId, code);
        }
        const result = JSON.parse(decoder.decode(commit.getResult())) as { passed: boolean; record: LedgerRecord; shipment?: LedgerShipment; failedRule?: LedgerOutcome['failedRule']; failure?: string; reason?: string };
        return { ...result, txId: status.transactionId, block: Number(status.blockNumber), timestamp: result.record.timestamp };
      }
    };
  }

  async function evaluate(fn: string, args: string[]) {
    try { return decoder.decode(await orgs.Org1MSP.contract.evaluateTransaction(fn, ...args)); } catch (err) {
      if (isUnavailable(err)) throw new LedgerError('unavailable', `Fabric peers are not reachable (${(err as Error).message})`);
      throw err;
    }
  }

  /**
   * Streams the chaincode events of committed blocks (through Org1's peer), so the API hears about
   * transactions from any client of the network. It resumes after the last delivered block if the
   * connection drops, and starts from options.fromBlock (a stored checkpoint) when given.
   */
  function listen(listener: (e: LedgerCommitEvent) => void | Promise<void>, fromBlock?: number) {
    let stopped = false;
    let next: bigint | undefined = fromBlock !== undefined ? BigInt(fromBlock) : undefined;
    let current: CloseableAsyncIterable<ChaincodeEvent> | undefined;
    void (async () => {
      while (!closed && !stopped) {
        try {
          current = await orgs.Org1MSP.network.getChaincodeEvents(cfg.chaincode, next === undefined ? undefined : { startBlock: next });
          streams.add(current);
          for await (const event of current) {
            if (stopped) break;
            let record: LedgerRecord;
            try { record = JSON.parse(decoder.decode(event.payload)) as LedgerRecord; } catch { continue; }
            await listener({ name: event.eventName, txId: event.transactionId, block: Number(event.blockNumber), record });
            // Resume from the same block after a reconnect; the listener ignores events it already processed.
            next = event.blockNumber;
          }
        } catch (err) {
          if (closed || stopped) return;
          logger.warn('fabric.events.interrupted', { error: (err as Error).message, retryInMs: 3000 });
        } finally {
          if (current) { current.close(); streams.delete(current); }
        }
        if (!closed && !stopped) await new Promise(resolve => setTimeout(resolve, 3_000));
      }
    })();
    return () => { stopped = true; current?.close(); };
  }

  const ledger: Ledger = {
    kind: 'fabric',
    async prepareRegister({ shipmentId, partId, requestedQty }) { return prepare('Org1MSP', 'RegisterRequest', [shipmentId, partId, String(requestedQty)]); },
    async prepareSubmit({ operation, shipmentId, qty, org }) { return prepare(org, FUNCTION[operation], NO_QUANTITY.includes(operation) ? [shipmentId] : [shipmentId, String(qty)]); },
    registerRequest: async input => (await ledger.prepareRegister(input)).submit(),
    submit: async input => (await ledger.prepareSubmit(input)).submit(),
    async read(shipmentId) {
      const text = await evaluate('ReadShipment', [shipmentId]);
      return text ? JSON.parse(text) as LedgerShipment : null;
    },
    async history(shipmentId) { return JSON.parse(await evaluate('GetHistory', [shipmentId])) as LedgerRecord[]; },
    async readRecord(txId) {
      const text = await evaluate('ReadTransactionRecord', [txId]);
      return text ? JSON.parse(text) as LedgerRecord : null;
    },
    async transactionStatus(txId): Promise<TransactionStatus> {
      // The query system chaincode (qscc) answers from the peer's block store, including invalid transactions.
      try {
        const tx = peer.ProcessedTransaction.deserializeBinary(await qscc.evaluateTransaction('GetTransactionByID', cfg.channel, txId));
        const code = TX_CODE[tx.getValidationcode()] ?? String(tx.getValidationcode());
        const block = common.Block.deserializeBinary(await qscc.evaluateTransaction('GetBlockByTxID', cfg.channel, txId)).getHeader()?.getNumber();
        return { state: code === 'VALID' ? 'valid' : 'invalid', code, block: block === undefined ? undefined : Number(block) };
      } catch (err) {
        if (isUnavailable(err)) throw new LedgerError('unavailable', `Fabric peers are not reachable (${(err as Error).message})`);
        const detail = err instanceof GatewayError ? err.details.map(d => d.message).join(' ') + err.message : (err as Error).message;
        if (/not found|no such transaction|Failed to get transaction/i.test(detail)) return { state: 'not_found' };
        throw err;
      }
    },
    async verify(shipmentId, expected): Promise<VerifyOutcome> {
      return JSON.parse(await evaluate('VerifyShipment', [shipmentId, JSON.stringify(expected)])) as VerifyOutcome;
    },
    onCommit(listener, options = {}) { return listen(listener, options.fromBlock); },
    async height() {
      try {
        const info = common.BlockchainInfo.deserializeBinary(await qscc.evaluateTransaction('GetChainInfo', cfg.channel));
        return Number(info.getHeight());
      } catch (err) {
        if (isUnavailable(err)) throw new LedgerError('unavailable', `Fabric peers are not reachable (${(err as Error).message})`);
        throw err;
      }
    },
    async health(): Promise<LedgerHealth> {
      const identities = Object.values(orgs).map(o => ({
        msp: o.identity.msp, subject: o.identity.subject, expires: o.identity.validTo.toISOString(),
        daysLeft: Math.floor((o.identity.validTo.getTime() - Date.now()) / 86_400_000)
      }));
      try {
        await evaluate('GetHistory', ['SHP-HEALTH-CHECK']);
        const expiring = identities.filter(i => i.daysLeft < 30);
        return { ok: identities.every(i => i.daysLeft >= 0), detail: expiring.length ? `Certificates expiring soon: ${expiring.map(i => i.msp).join(', ')}` : `Connected to channel ${cfg.channel}, chaincode ${cfg.chaincode}`, identities };
      } catch (err) {
        return { ok: false, detail: `Fabric query failed: ${(err as Error).message}`, identities };
      }
    },
    async close() {
      closed = true;
      for (const s of streams) s.close();
      for (const o of Object.values(orgs)) { o.gateway.close(); o.client.close(); }
    }
  };
  return ledger;
}
