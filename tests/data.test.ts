import { describe, it, expect } from 'vitest';
import { PARTS, BASE_INVENTORY, allDemandRecords, initialData, computeInventory, series } from '../src/data/mock';
import { getForecast, calculateMetrics, policyMetrics } from '../src/data/forecast';
describe('Synthetic data consistency', () => {
  it('contains expected inventory and demand coverage', () => {
    expect(PARTS).toHaveLength(60); expect(BASE_INVENTORY).toHaveLength(180); expect(allDemandRecords()).toHaveLength(12960);
    expect(series('SP-001', 'Central Warehouse')).toHaveLength(72);
  });
  it('references only existing parts and matching transaction shipments', () => {
    const d = initialData(); const partIds = new Set(PARTS.map(p => p.id)); const shipmentIds = new Set(d.shipments.map(s => s.id));
    expect(d.shipments.length).toBeGreaterThanOrEqual(40);
    expect(d.transactions.filter(t => t.status === 'Rejected')).toHaveLength(10); expect(d.transactions.filter(t => t.status === 'Rejected').every(t => t.type === 'ATTEMPT')).toBe(true);
    for (const s of d.shipments) expect(partIds.has(s.partId)).toBe(true);
    for (const t of d.transactions) { expect(t.hash).toMatch(/^[0-9a-f]{64}$/); if (t.status === 'Committed') expect(shipmentIds.has(t.shipmentId)).toBe(true); else expect(t.block).toBeUndefined(); }
  });
  it('updates in-transit and on-hand positions for user-created transfers', () => {
    const d = initialData(); const x = d.shipments[0]; const s = { ...x, id: 'SHP-2026-9999', partId: 'SP-001', quantity: 10, dispatchedQty: 10, receivedQty: undefined, from: 'Central Warehouse' as const, to: 'Distribution Center' as const, status: 'In Transit' as const, createdInSession: true };
    const before = computeInventory(d.shipments); const inTransit = computeInventory([...d.shipments, s]);
    const origin = (a: typeof before) => a.find(r => r.partId === 'SP-001' && r.location === 'Central Warehouse')!;
    const target = (a: typeof before) => a.find(r => r.partId === 'SP-001' && r.location === 'Distribution Center')!;
    expect(origin(inTransit).onHand).toBe(Math.max(0, origin(before).onHand - 10));
    expect(target(inTransit).inTransit).toBe(target(before).inTransit + 10);
    const received = computeInventory([...d.shipments, { ...s, status: 'Received' as const, receivedQty: 9 }]);
    expect(target(received).onHand).toBe(target(before).onHand + 9);
  });
});
describe('Forecast methodology', () => {
  it('has a 60/12 chronological split and consistent holdout metrics', () => {
    const f = getForecast('SP-002', 'All locations', 6);
    expect(f.train).toHaveLength(60); expect(f.observed).toHaveLength(12); expect(f.points).toHaveLength(78);
    expect(f.metrics.Croston.mae).toBeCloseTo(calculateMetrics(f.observed, f.holdouts.Croston, f.train).mae);
  });
  it('simulates two comparable replenishment policies', () => {
    const p = policyMetrics(); expect(p).toHaveLength(4); for (const r of p) { expect(r.reorderFill).toBeGreaterThanOrEqual(0); expect(r.reorderFill).toBeLessThanOrEqual(100); expect(r.reorderStock).toBeGreaterThanOrEqual(0); }
  });
});
