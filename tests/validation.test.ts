import { describe, it, expect } from 'vitest';
import { initialData } from '../src/data/mock';
import { allowed, validateOperation } from '../src/utils/core';
describe('Role permissions', () => {
  it('restricts operational updates', () => {
    expect(allowed('Planner', 'request')).toBe(true); expect(allowed('Admin', 'request')).toBe(false);
    expect(allowed('Receiver', 'forecasts')).toBe(false); expect(allowed('Dispatcher', 'transit')).toBe(true);
    expect(allowed('Receiver', 'receive')).toBe(true); expect(allowed('Admin', 'users')).toBe(true);
  });
});
describe('Simulated transaction rule engine', () => {
  const d = initialData(), requested = d.shipments.find(s => s.status === 'Requested')!, inTransit = d.shipments.find(s => s.status === 'In Transit')!, received = d.shipments.find(s => s.status === 'Received')!;
  it('accepts authorized dispatch and valid receipt', () => {
    expect(validateOperation('dispatch', requested, requested.quantity, 'Dispatcher', d.transactions).passed).toBe(true);
    expect(validateOperation('receive', inTransit, inTransit.dispatchedQty!, 'Receiver', d.transactions).passed).toBe(true);
  });
  it('rejects unauthorized operation', () => expect(validateOperation('dispatch', requested, requested.quantity, 'Planner', d.transactions).failure).toBe('Authorized organization'));
  it('rejects duplicate receipt specifically', () => expect(validateOperation('receive', received, received.quantity, 'Receiver', d.transactions).failure).toBe('No duplicate receipt'));
  it('rejects invalid status transition', () => expect(validateOperation('dispatch', received, received.quantity, 'Dispatcher', d.transactions).failure).toBe('Valid status transition'));
  it('rejects excessive quantities', () => expect(validateOperation('receive', inTransit, inTransit.dispatchedQty! + 2, 'Receiver', d.transactions).failure).toBe('Valid quantity'));
  it('rejects unknown shipment references', () => expect(validateOperation('receive', undefined, 2, 'Receiver', d.transactions, 'SHP-UNKNOWN-9999').failure).toBe('Valid shipment reference'));
});
