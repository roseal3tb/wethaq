import { describe, expect, it } from 'vitest';
import { checkRules, type LedgerShipment } from '../../chaincode/shipment/src/rules.js';

const ship = (over: Partial<LedgerShipment> = {}): LedgerShipment => ({ docType: 'shipment', shipmentId: 'SHP-1', partId: 'SP-001', requestedQty: 10, status: 'Requested', updatedAt: '', lastTxId: '', ...over });

// The examples of Table D.2, applied to the chaincode rules.
describe('chaincode rules', () => {
  it('accepts a dispatch by Org1 within the requested quantity', () => expect(checkRules('dispatch', ship(), 10, 'Org1MSP').passed).toBe(true));
  it('accepts a receipt by Org2 of an in-transit shipment', () => expect(checkRules('receive', ship({ status: 'In Transit', dispatchedQty: 8 }), 8, 'Org2MSP').passed).toBe(true));
  it('accepts a short receipt (the API raises a discrepancy alert)', () => expect(checkRules('receive', ship({ status: 'Dispatched', dispatchedQty: 8 }), 6, 'Org2MSP').passed).toBe(true));
  it('rejects a dispatch submitted by Org2', () => expect(checkRules('dispatch', ship(), 5, 'Org2MSP').failedRule).toBe('authorizedOrg'));
  it('rejects a dispatch of a received shipment', () => expect(checkRules('dispatch', ship({ status: 'Received', dispatchedQty: 5, receivedQty: 5 }), 5, 'Org1MSP').failedRule).toBe('validTransition'));
  it('rejects a receipt above the dispatched quantity', () => expect(checkRules('receive', ship({ status: 'In Transit', dispatchedQty: 8 }), 9, 'Org2MSP').failedRule).toBe('validQuantity'));
  it('rejects an unknown shipment reference', () => expect(checkRules('receive', null, 1, 'Org2MSP').failedRule).toBe('validReference'));
  it('rejects a second receipt as a duplicate before checking the transition', () => expect(checkRules('receive', ship({ status: 'Received', dispatchedQty: 8, receivedQty: 8 }), 8, 'Org2MSP').failedRule).toBe('noDuplicate'));
  it('rejects zero, negative and fractional quantities', () => {
    for (const qty of [0, -1, 2.5]) expect(checkRules('dispatch', ship(), qty, 'Org1MSP').failedRule).toBe('validQuantity');
  });
  it('rejects in-transit from Requested', () => expect(checkRules('transit', ship(), 0, 'Org1MSP').failedRule).toBe('validTransition'));
  it('reports the first failure in priority order', () => expect(checkRules('dispatch', null, -1, 'Org2MSP').failedRule).toBe('authorizedOrg'));
});
