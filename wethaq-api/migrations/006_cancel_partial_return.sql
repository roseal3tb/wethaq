-- GP2: cancellation, partial receipts and returns (blocker B5; chaincode version 2, chaincode/shipment/src/rules.ts).
-- New shipment states: Partially Received, Cancelled and Returned. New record types: PARTIAL_RECEIPT, CANCELLATION
-- and RETURN. Existing rows are valid under the new constraints, so nothing is rewritten.

ALTER TABLE shipments ADD COLUMN returned_qty INTEGER CHECK (returned_qty > 0);

ALTER TABLE shipments DROP CONSTRAINT shipments_status_check;
ALTER TABLE shipments ADD CONSTRAINT shipments_status_check CHECK (status IN ('Requested', 'Dispatched', 'In Transit', 'Partially Received', 'Received', 'Cancelled', 'Returned'));
ALTER TABLE shipment_events DROP CONSTRAINT shipment_events_status_check;
ALTER TABLE shipment_events ADD CONSTRAINT shipment_events_status_check CHECK (status IN ('Requested', 'Dispatched', 'In Transit', 'Partially Received', 'Received', 'Cancelled', 'Returned'));

ALTER TABLE ledger_records DROP CONSTRAINT ledger_records_type_check;
ALTER TABLE ledger_records ADD CONSTRAINT ledger_records_type_check CHECK (type IN ('REQUEST', 'DISPATCH', 'STATUS_CHANGE', 'RECEIPT', 'PARTIAL_RECEIPT', 'CANCELLATION', 'RETURN', 'ATTEMPT'));
ALTER TABLE ledger_operations DROP CONSTRAINT ledger_operations_kind_check;
ALTER TABLE ledger_operations ADD CONSTRAINT ledger_operations_kind_check CHECK (kind IN ('request', 'dispatch', 'transit', 'receive', 'receivePartial', 'cancel', 'return', 'demo'));

-- The quantities each state allows (the chaincode's rules): a partial receipt leaves something outstanding, a
-- cancelled shipment has received nothing, and a return is no more than was received.
ALTER TABLE shipments DROP CONSTRAINT shipments_status_quantities;
ALTER TABLE shipments ADD CONSTRAINT shipments_status_quantities CHECK (
  (status = 'Requested' AND dispatched_qty IS NULL AND received_qty IS NULL AND returned_qty IS NULL)
  OR (status IN ('Dispatched', 'In Transit') AND dispatched_qty IS NOT NULL AND received_qty IS NULL AND returned_qty IS NULL)
  OR (status = 'Partially Received' AND dispatched_qty IS NOT NULL AND received_qty > 0 AND received_qty < dispatched_qty AND returned_qty IS NULL)
  OR (status = 'Received' AND dispatched_qty IS NOT NULL AND received_qty IS NOT NULL AND returned_qty IS NULL)
  OR (status = 'Cancelled' AND received_qty IS NULL AND returned_qty IS NULL)
  OR (status = 'Returned' AND dispatched_qty IS NOT NULL AND received_qty IS NOT NULL AND returned_qty IS NOT NULL));
ALTER TABLE shipments ADD CONSTRAINT shipments_returned_le_received CHECK (returned_qty IS NULL OR (received_qty IS NOT NULL AND returned_qty <= received_qty));
