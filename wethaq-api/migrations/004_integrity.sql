-- Integrity rules and indexes added in the final GP482 review.

-- Shipment quantities follow the chaincode's quantity rule (chaincode/shipment/src/rules.ts): a dispatch is no more
-- than the requested quantity, a receipt no more than the dispatched quantity, and nothing is received before it is
-- dispatched. The ledger enforces these on Fabric; the reporting copy now refuses rows that break them as well.
ALTER TABLE shipments ADD CONSTRAINT shipments_dispatched_le_requested CHECK (dispatched_qty IS NULL OR dispatched_qty <= requested_qty);
ALTER TABLE shipments ADD CONSTRAINT shipments_received_le_dispatched CHECK (received_qty IS NULL OR (dispatched_qty IS NOT NULL AND received_qty <= dispatched_qty));
ALTER TABLE shipments ADD CONSTRAINT shipments_status_quantities CHECK (
  (status = 'Requested' AND dispatched_qty IS NULL AND received_qty IS NULL)
  OR (status IN ('Dispatched', 'In Transit') AND dispatched_qty IS NOT NULL AND received_qty IS NULL)
  OR (status = 'Received' AND dispatched_qty IS NOT NULL AND received_qty IS NOT NULL));

-- Indexes for the list, filter and traceability endpoints.
CREATE INDEX shipments_requested_at_idx ON shipments(requested_at DESC, shipment_id DESC);
CREATE INDEX shipments_part_idx ON shipments(part_id);
CREATE INDEX shipments_to_location_idx ON shipments(to_location);
CREATE INDEX ledger_records_timestamp_idx ON ledger_records(timestamp DESC, record_id DESC);
CREATE INDEX alerts_at_idx ON alerts(at DESC);
CREATE INDEX alerts_open_idx ON alerts(at DESC) WHERE NOT acknowledged;
CREATE INDEX ledger_operations_shipment_idx ON ledger_operations(shipment_id);
CREATE INDEX audit_log_action_idx ON audit_log(action, audit_id DESC);
CREATE INDEX audit_log_user_idx ON audit_log(user_id, audit_id DESC);

-- The audit log is append-only: rows can be added but never changed or deleted through SQL UPDATE or DELETE.
-- (TRUNCATE stays possible for the database owner, which the development seed script uses with --reset.)
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% is not allowed)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
