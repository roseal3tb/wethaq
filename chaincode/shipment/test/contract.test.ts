// Tests the compiled contract (npm test builds first) with an in-memory stand-in for the Fabric stub.
import { beforeEach, describe, expect, it } from 'vitest';
import { ShipmentContract } from '../dist/contract';

class FakeStub {
  state = new Map<string, Buffer>();
  events: { name: string; payload: string }[] = [];
  private n = 0; txId = ''; time = Date.UTC(2026, 10, 27, 9) / 1000;
  begin() { this.n += 1; this.txId = this.n.toString(16).padStart(64, '0'); this.time += 1; }
  getTxID() { return this.txId; }
  getTxTimestamp() { return { seconds: { toNumber: () => this.time }, nanos: 0 }; }
  async getState(key: string) { return this.state.get(key) ?? Buffer.alloc(0); }
  async putState(key: string, value: Buffer) { this.state.set(key, value); }
  // Same layout as fabric-shim: \u0000type\u0000attr1\u0000attr2\u0000
  createCompositeKey(type: string, attrs: string[]) { return `\u0000${type}\u0000${attrs.map(a => `${a}\u0000`).join('')}`; }
  private matching(type: string, attrs: string[]) {
    const prefix = this.createCompositeKey(type, attrs);
    return [...this.state.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
  }
  private iterate(items: [string, Buffer][]) {
    let i = 0;
    return { next: async () => i < items.length ? { done: false, value: { key: items[i][0], value: items[i++][1] } } : { done: true, value: undefined }, close: async () => undefined };
  }
  async getStateByPartialCompositeKey(type: string, attrs: string[]) { return this.iterate(this.matching(type, attrs)); }
  async getStateByPartialCompositeKeyWithPagination(type: string, attrs: string[], pageSize: number, bookmark: string) {
    const all = this.matching(type, attrs); const start = bookmark ? all.findIndex(([k]) => k === bookmark) : 0;
    const page = all.slice(start, start + pageSize); const next = all[start + pageSize]?.[0] ?? '';
    return { iterator: this.iterate(page), metadata: { fetchedRecordsCount: page.length, bookmark: next } };
  }
  setEvent(name: string, payload: Buffer) { this.events.push({ name, payload: payload.toString() }); }
}

let stub: FakeStub; const contract = new ShipmentContract();
const ctx = (msp: string) => { stub.begin(); return { stub, clientIdentity: { getMSPID: () => msp } } as never; };
const run = async (p: Promise<string>) => JSON.parse(await p);

beforeEach(async () => {
  stub = new FakeStub();
  await contract.RegisterRequest(ctx('Org1MSP'), 'SHP-2026-0001', 'SP-001', '10');
});

describe('ShipmentContract', () => {
  it('registers a request only from Org1, and only once', async () => {
    expect(stub.events.at(-1)).toMatchObject({ name: 'ShipmentRegistered', payload: expect.stringContaining('"operation":"request"') });
    await expect(contract.RegisterRequest(ctx('Org2MSP'), 'SHP-2026-0002', 'SP-001', '5')).rejects.toThrow(/Only Org1/);
    await expect(contract.RegisterRequest(ctx('Org1MSP'), 'SHP-2026-0001', 'SP-001', '5')).rejects.toThrow(/already exists/);
    await expect(contract.RegisterRequest(ctx('Org1MSP'), 'SHP-2026-0003', 'SP-001', '0')).rejects.toThrow(/positive/);
    expect(JSON.parse(await contract.ReadShipment(ctx('Org2MSP'), 'SHP-2026-0001'))).toMatchObject({ status: 'Requested', requestedQty: 10 });
  });

  it('runs the full workflow with a short receipt', async () => {
    expect((await run(contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10'))).passed).toBe(true);
    expect((await run(contract.MarkInTransit(ctx('Org1MSP'), 'SHP-2026-0001'))).passed).toBe(true);
    const receipt = await run(contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '8'));
    expect(receipt).toMatchObject({ passed: true, shipment: { status: 'Received', dispatchedQty: 10, receivedQty: 8 } });
    expect(receipt.record).toMatchObject({ operation: 'receive', quantity: 8, org: 'Org2MSP', fromStatus: 'In Transit', toStatus: 'Received', timestamp: expect.stringMatching(/^2026-11-27T09:00:0\d\.000Z$/) });
  });

  it('records a rejected attempt without changing the shipment', async () => {
    const before = await contract.ReadShipment(ctx('Org1MSP'), 'SHP-2026-0001');
    const result = await run(contract.Dispatch(ctx('Org2MSP'), 'SHP-2026-0001', '5'));
    expect(result).toMatchObject({ passed: false, failedRule: 'authorizedOrg', record: { status: 'Rejected', org: 'Org2MSP' } });
    expect(await contract.ReadShipment(ctx('Org1MSP'), 'SHP-2026-0001')).toBe(before);
    expect(stub.events.at(-1)?.name).toBe('OperationRejected');
  });

  it.each([
    ['dispatch above the requested quantity', () => contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '11'), 'validQuantity'],
    ['dispatch with a non-numeric quantity', () => contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', 'ten'), 'validQuantity'],
    ['receipt before dispatch', () => contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '0'), 'validQuantity'],
    ['in transit before dispatch', () => contract.MarkInTransit(ctx('Org1MSP'), 'SHP-2026-0001'), 'validTransition'],
    ['an unknown shipment', () => contract.Receive(ctx('Org2MSP'), 'SHP-NOPE', '1'), 'validReference']
  ])('rejects %s', async (_name, call, rule) => {
    expect((await run(call())).failedRule).toBe(rule);
  });

  it('rejects a duplicate receipt', async () => {
    await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
    await contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '10');
    expect((await run(contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '10'))).failedRule).toBe('noDuplicate');
  });

  it('returns the full history, including rejected attempts, in order', async () => {
    await contract.Dispatch(ctx('Org2MSP'), 'SHP-2026-0001', '10');
    await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
    const history = JSON.parse(await contract.GetHistory(ctx('Org1MSP'), 'SHP-2026-0001'));
    expect(history.map((r: { operation: string; status: string }) => `${r.operation}:${r.status}`)).toEqual(['request:Committed', 'dispatch:Rejected', 'dispatch:Committed']);
  });

  it('writes values with sorted keys so endorsements match byte for byte', async () => {
    const raw = await contract.ReadShipment(ctx('Org1MSP'), 'SHP-2026-0001');
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual([...keys].sort());
  });

  it.each([
    ['zero', '0'], ['negative', '-3'], ['non-integer', '2.5'], ['excessive', '11'], ['empty', '']
  ])('rejects a %s dispatch quantity (validQuantity)', async (_name, qty) => {
    const result = await run(contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', qty));
    expect(result).toMatchObject({ passed: false, failedRule: 'validQuantity' });
    expect(JSON.parse(await contract.ReadShipment(ctx('Org1MSP'), 'SHP-2026-0001')).status).toBe('Requested');
  });

  it('accepts a receipt straight from Dispatched (the existing lifecycle rule)', async () => {
    await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
    expect((await run(contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '10'))).passed).toBe(true);
  });

  it('applies the rules in priority order: authorizedOrg before validReference, noDuplicate before validQuantity', async () => {
    // Wrong organization and unknown shipment: the organization rule is reported first.
    expect((await run(contract.Receive(ctx('Org1MSP'), 'SHP-NOPE', '1'))).failedRule).toBe('authorizedOrg');
    await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
    await contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '10');
    // Duplicate receipt with an excessive quantity: the duplicate rule is reported first.
    expect((await run(contract.Receive(ctx('Org2MSP'), 'SHP-2026-0001', '99'))).failedRule).toBe('noDuplicate');
    // Org1 receiving an already received shipment: still authorizedOrg first.
    expect((await run(contract.Receive(ctx('Org1MSP'), 'SHP-2026-0001', '10'))).failedRule).toBe('authorizedOrg');
  });

  it('uses the Fabric transaction id and timestamp, never its own', async () => {
    const result = await run(contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10'));
    expect(result.record.txId).toBe(stub.txId);
    expect(result.shipment.lastTxId).toBe(stub.txId);
    expect(result.record.timestamp).toBe(new Date(stub.time * 1000).toISOString());
  });

  it('is deterministic: the same transaction on two peers writes identical bytes', async () => {
    const write = async () => {
      stub = new FakeStub();
      await contract.RegisterRequest(ctx('Org1MSP'), 'SHP-2026-0001', 'SP-001', '10');
      await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
      return [...stub.state.entries()].map(([k, v]) => `${k}=${v.toString()}`).join('|');
    };
    expect(await write()).toBe(await write());
  });

  it('rejects malformed shipment identifiers before reading state', async () => {
    await expect(contract.Dispatch(ctx('Org1MSP'), 'bad id with spaces', '1')).rejects.toThrow(/Invalid shipment identifier/);
    await expect(contract.Dispatch(ctx('Org1MSP'), 'X'.repeat(65), '1')).rejects.toThrow(/Invalid shipment identifier/);
  });

  it('reads one transaction record by its transaction id, including a rejected attempt', async () => {
    const rejected = await run(contract.Dispatch(ctx('Org2MSP'), 'SHP-2026-0001', '10'));
    const record = JSON.parse(await contract.ReadTransactionRecord(ctx('Org1MSP'), rejected.record.txId));
    expect(record).toMatchObject({ txId: rejected.record.txId, status: 'Rejected', failedRule: 'authorizedOrg' });
    expect(await contract.ReadTransactionRecord(ctx('Org1MSP'), 'f'.repeat(64))).toBe('');
    await expect(contract.ReadTransactionRecord(ctx('Org1MSP'), 'not-a-tx')).rejects.toThrow(/Invalid transaction id/);
  });

  it('queries transaction records by shipment, operation and outcome, in pages', async () => {
    await contract.RegisterRequest(ctx('Org1MSP'), 'SHP-2026-0002', 'SP-002', '4');
    await contract.Dispatch(ctx('Org2MSP'), 'SHP-2026-0001', '10');
    await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
    const rejected = await run(contract.QueryTransactionRecords(ctx('Org1MSP'), 'SHP-2026-0001', '', 'Rejected', '50', ''));
    expect(rejected.records).toHaveLength(1);
    const dispatches = await run(contract.QueryTransactionRecords(ctx('Org1MSP'), '', 'dispatch', '', '50', ''));
    expect(dispatches.records).toHaveLength(2);
    const page1 = await run(contract.QueryTransactionRecords(ctx('Org1MSP'), '', '', '', '2', ''));
    const page2 = await run(contract.QueryTransactionRecords(ctx('Org1MSP'), '', '', '', '2', page1.bookmark));
    expect(page1.records).toHaveLength(2); expect(page2.records).toHaveLength(2);
    await expect(contract.QueryTransactionRecords(ctx('Org1MSP'), '', '', '', '500', '')).rejects.toThrow(/pageSize/);
  });

  it('verifies an off-chain copy against the ledger state', async () => {
    await contract.Dispatch(ctx('Org1MSP'), 'SHP-2026-0001', '10');
    const ok = await run(contract.VerifyShipment(ctx('Org1MSP'), 'SHP-2026-0001', JSON.stringify({ status: 'Dispatched', dispatchedQty: 10, requestedQty: 10 })));
    expect(ok).toMatchObject({ found: true, match: true, differences: [] });
    const bad = await run(contract.VerifyShipment(ctx('Org1MSP'), 'SHP-2026-0001', JSON.stringify({ status: 'Received', dispatchedQty: 9 })));
    expect(bad.match).toBe(false); expect(bad.differences).toHaveLength(2);
    expect((await run(contract.VerifyShipment(ctx('Org1MSP'), 'SHP-NOPE', '{}'))).found).toBe(false);
  });

  describe('version 2: cancellation, partial receipts and returns (B5)', () => {
    const id = 'SHP-2026-0001';
    const dispatch = (qty = '10') => contract.Dispatch(ctx('Org1MSP'), id, qty);

    it('cancels a requested shipment from Org1 only', async () => {
      expect((await run(contract.Cancel(ctx('Org2MSP'), id))).failedRule).toBe('authorizedOrg');
      const result = await run(contract.Cancel(ctx('Org1MSP'), id));
      expect(result).toMatchObject({ passed: true, shipment: { status: 'Cancelled' }, record: { operation: 'cancel', quantity: 0, fromStatus: 'Requested', toStatus: 'Cancelled' } });
      expect((await run(dispatch())).failedRule).toBe('validTransition');
    });

    it('cancels a dispatched shipment and records the dispatched quantity', async () => {
      await dispatch('7');
      const result = await run(contract.Cancel(ctx('Org1MSP'), id));
      expect(result).toMatchObject({ passed: true, shipment: { status: 'Cancelled', dispatchedQty: 7 }, record: { quantity: 7, fromStatus: 'Dispatched' } });
      expect((await run(contract.Receive(ctx('Org2MSP'), id, '7'))).failedRule).toBe('validTransition');
    });

    it('does not cancel once the shipment is in transit', async () => {
      await dispatch(); await contract.MarkInTransit(ctx('Org1MSP'), id);
      expect((await run(contract.Cancel(ctx('Org1MSP'), id))).failedRule).toBe('validTransition');
    });

    it('adds partial receipts up and closes the shipment with the last part', async () => {
      await dispatch();
      const first = await run(contract.ReceivePartial(ctx('Org2MSP'), id, '4'));
      expect(first).toMatchObject({ passed: true, shipment: { status: 'Partially Received', receivedQty: 4 }, record: { operation: 'receivePartial', quantity: 4 } });
      const second = await run(contract.ReceivePartial(ctx('Org2MSP'), id, '3'));
      expect(second.shipment).toMatchObject({ status: 'Partially Received', receivedQty: 7 });
      // only 3 are outstanding
      expect((await run(contract.Receive(ctx('Org2MSP'), id, '4'))).failedRule).toBe('validQuantity');
      const last = await run(contract.Receive(ctx('Org2MSP'), id, '3'));
      expect(last).toMatchObject({ passed: true, shipment: { status: 'Received', receivedQty: 10 }, record: { quantity: 3, fromStatus: 'Partially Received' } });
      expect((await run(contract.Receive(ctx('Org2MSP'), id, '1'))).failedRule).toBe('noDuplicate');
      expect((await run(contract.ReceivePartial(ctx('Org2MSP'), id, '1'))).failedRule).toBe('noDuplicate');
    });

    it('closes a partly received shipment short, as a single short receipt does', async () => {
      await dispatch(); await contract.ReceivePartial(ctx('Org2MSP'), id, '6');
      expect((await run(contract.Receive(ctx('Org2MSP'), id, '2'))).shipment).toMatchObject({ status: 'Received', dispatchedQty: 10, receivedQty: 8 });
    });

    it('rejects a partial receipt that would cover everything outstanding, and one from Org1', async () => {
      await dispatch();
      const all = await run(contract.ReceivePartial(ctx('Org2MSP'), id, '10'));
      expect(all).toMatchObject({ passed: false, failedRule: 'validQuantity', reason: expect.stringContaining('below the 10 still outstanding') });
      expect((await run(contract.ReceivePartial(ctx('Org1MSP'), id, '2'))).failedRule).toBe('authorizedOrg');
      expect((await run(contract.Cancel(ctx('Org1MSP'), id))).passed).toBe(true);
      expect((await run(contract.ReceivePartial(ctx('Org2MSP'), id, '2'))).failedRule).toBe('validTransition');
    });

    it('returns up to the received quantity, once, from Org2', async () => {
      await dispatch(); await contract.Receive(ctx('Org2MSP'), id, '9');
      expect((await run(contract.Return(ctx('Org1MSP'), id, '2'))).failedRule).toBe('authorizedOrg');
      expect((await run(contract.Return(ctx('Org2MSP'), id, '10'))).failedRule).toBe('validQuantity');
      const result = await run(contract.Return(ctx('Org2MSP'), id, '2'));
      expect(result).toMatchObject({ passed: true, shipment: { status: 'Returned', receivedQty: 9, returnedQty: 2 }, record: { operation: 'return', quantity: 2, fromStatus: 'Received', toStatus: 'Returned' } });
      expect((await run(contract.Return(ctx('Org2MSP'), id, '1'))).failedRule).toBe('validTransition');
      expect((await run(contract.Receive(ctx('Org2MSP'), id, '1'))).failedRule).toBe('noDuplicate');
    });

    it('does not return what has not been fully received', async () => {
      await dispatch(); await contract.ReceivePartial(ctx('Org2MSP'), id, '4');
      expect((await run(contract.Return(ctx('Org2MSP'), id, '1'))).failedRule).toBe('validTransition');
    });

    it('reads a version 1 shipment the same way', async () => {
      // A version 1 receipt stored receivedQty with status Received and no returnedQty field.
      await dispatch(); await contract.Receive(ctx('Org2MSP'), id, '10');
      const stored = JSON.parse(await contract.ReadShipment(ctx('Org1MSP'), id));
      expect(stored).not.toHaveProperty('returnedQty');
      expect((await run(contract.ReceivePartial(ctx('Org2MSP'), id, '1'))).failedRule).toBe('noDuplicate');
      const verified = JSON.parse(await contract.VerifyShipment(ctx('Org1MSP'), id, JSON.stringify({ status: 'Received', receivedQty: 10 })));
      expect(verified).toMatchObject({ found: true, match: true });
    });

    it('queries and verifies the new operations', async () => {
      await dispatch(); await contract.ReceivePartial(ctx('Org2MSP'), id, '5'); await contract.Receive(ctx('Org2MSP'), id, '5'); await contract.Return(ctx('Org2MSP'), id, '1');
      for (const op of ['receivePartial', 'return']) {
        const page = JSON.parse(await contract.QueryTransactionRecords(ctx('Org1MSP'), id, op, 'Committed', '50', ''));
        expect(page.records).toHaveLength(1);
      }
      await expect(contract.QueryTransactionRecords(ctx('Org1MSP'), id, 'refund', '', '50', '')).rejects.toThrow(/Invalid operation/);
      const verified = JSON.parse(await contract.VerifyShipment(ctx('Org1MSP'), id, JSON.stringify({ status: 'Returned', receivedQty: 10, returnedQty: 2 })));
      expect(verified).toMatchObject({ match: false, differences: ['Returned quantity: database 2, ledger 1'] });
    });
  });
});
