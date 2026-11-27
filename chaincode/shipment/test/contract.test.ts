// Tests the compiled contract (npm test builds first) with an in-memory stand-in for the Fabric stub.
import { beforeEach, describe, expect, it } from 'vitest';
import { ShipmentContract } from '../dist/contract';

class FakeStub {
  state = new Map<string, Buffer>();
  events: { name: string; payload: string }[] = [];
  private n = 0; txId = ''; time = Date.UTC(2026, 10, 27, 9) / 1000;
  begin() { this.n += 1; this.txId = `tx${String(this.n).padStart(4, '0')}`; this.time += 1; }
  getTxID() { return this.txId; }
  getTxTimestamp() { return { seconds: { toNumber: () => this.time }, nanos: 0 }; }
  async getState(key: string) { return this.state.get(key) ?? Buffer.alloc(0); }
  async putState(key: string, value: Buffer) { this.state.set(key, value); }
  createCompositeKey(type: string, attrs: string[]) { return `\u0000${type}\u0000${attrs.join('\u0000')}\u0000`; }
  async getStateByPartialCompositeKey(type: string, attrs: string[]) {
    const prefix = `\u0000${type}\u0000${attrs.join('\u0000')}\u0000`;
    const items = [...this.state.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
    let i = 0;
    return { next: async () => i < items.length ? { done: false, value: { key: items[i][0], value: items[i++][1] } } : { done: true, value: undefined }, close: async () => undefined };
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
});
