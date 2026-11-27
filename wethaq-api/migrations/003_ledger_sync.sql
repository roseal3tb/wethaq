-- Durable tracking of every ledger submission (Section 4.3.6, synchronization between Fabric and PostgreSQL).
-- The row is written before the transaction is submitted, with the Fabric transaction id, so the API can always
-- find out what happened to it after a crash, a timeout or a restart, and apply its result exactly once.
CREATE TABLE ledger_operations (
  operation_id    TEXT PRIMARY KEY,                 -- the ledger transaction id
  idempotency_key TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('request', 'dispatch', 'transit', 'receive', 'demo')),
  shipment_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  user_name       TEXT NOT NULL,
  org             TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  options         JSONB NOT NULL DEFAULT '{}',
  state           TEXT NOT NULL CHECK (state IN ('submitting', 'unknown', 'committed', 'rejected', 'failed')),
  failure         TEXT,                             -- LedgerError category for failed or unknown operations
  error           TEXT,
  block           BIGINT,
  response        JSONB,                            -- the API response, replayed for a repeated Idempotency-Key
  attempts        INTEGER NOT NULL DEFAULT 0,       -- reconciliation attempts
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ                       -- when the result was applied to the PostgreSQL projection
);
CREATE UNIQUE INDEX ledger_operations_idem_idx ON ledger_operations(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ledger_operations_open_idx ON ledger_operations(state) WHERE applied_at IS NULL;

-- Where each event consumer stopped, so it resumes after a restart without missing or reapplying events.
CREATE TABLE event_checkpoints (
  name       TEXT PRIMARY KEY,
  block      BIGINT NOT NULL,
  tx_id      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Application audit log: sign-ins, refused requests, user changes, application-level rejections, Fabric failures.
-- Never contains passwords, tokens or keys.
CREATE TABLE audit_log (
  audit_id   BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id TEXT,
  user_id    TEXT,
  org        TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  outcome    TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);

-- A shipment request whose ledger registration is not yet confirmed stays 'pending' (it is not deleted while
-- the transaction might still have committed).
ALTER TABLE shipments ADD COLUMN ledger_state TEXT NOT NULL DEFAULT 'confirmed' CHECK (ledger_state IN ('pending', 'confirmed', 'failed'));
ALTER TABLE shipments ADD COLUMN last_tx_id TEXT;

-- Alerts: more types, and a key that stops the same condition from raising duplicate open alerts.
ALTER TABLE alerts DROP CONSTRAINT alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN ('Shortage', 'Discrepancy', 'Delay', 'Rejected attempt', 'Ledger sync', 'Pending transaction'));
ALTER TABLE alerts ADD COLUMN dedupe_key TEXT;
ALTER TABLE alerts ADD COLUMN acknowledged_at TIMESTAMPTZ;
CREATE UNIQUE INDEX alerts_open_dedupe_idx ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL AND NOT acknowledged
;
UPDATE shipments s SET last_tx_id = (
  SELECT r.tx_id FROM ledger_records r
  WHERE r.shipment_id = s.shipment_id AND r.source = 'chaincode' AND r.status = 'Committed'
  ORDER BY r.timestamp DESC, r.record_id DESC LIMIT 1
);

-- Timeline entries for transactions submitted by other clients of the network have no Wethaq user.
ALTER TABLE shipment_events ALTER COLUMN actor_id DROP NOT NULL;
