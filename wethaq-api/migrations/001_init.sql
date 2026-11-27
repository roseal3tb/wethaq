-- Wethaq relational model (Section 4.4.2, Figure 4.10).
-- PostgreSQL keeps the data the dashboard needs for views and reports.
-- The Fabric ledger remains the reference for transfer records; ledger_records is a reporting copy.

CREATE TABLE organizations (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  msp_id      TEXT UNIQUE            -- Fabric MSP for peer organizations (Org1MSP, Org2MSP); NULL otherwise
);

CREATE TABLE roles (
  role_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE CHECK (name IN ('Planner', 'Dispatcher', 'Receiver', 'Admin'))
);

CREATE TABLE users (
  user_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id       TEXT NOT NULL REFERENCES roles(role_id),
  org_id        TEXT NOT NULL REFERENCES organizations(org_id),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parts (
  part_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  demand_class TEXT NOT NULL CHECK (demand_class IN ('Smooth', 'Erratic', 'Intermittent', 'Lumpy')),
  criticality  TEXT NOT NULL CHECK (criticality IN ('Critical', 'Standard')),
  unit         TEXT NOT NULL DEFAULT 'units'
);

CREATE TABLE locations (
  location_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE
);

CREATE TABLE inventory (
  part_id        TEXT NOT NULL REFERENCES parts(part_id),
  location_id    TEXT NOT NULL REFERENCES locations(location_id),
  on_hand        INTEGER NOT NULL CHECK (on_hand >= 0),
  reorder_point  INTEGER NOT NULL CHECK (reorder_point >= 0),
  safety_stock   INTEGER NOT NULL CHECK (safety_stock >= 0),
  lead_days      INTEGER NOT NULL CHECK (lead_days > 0),
  monthly_demand NUMERIC(12, 4) NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (part_id, location_id)
);

CREATE TABLE forecasts (
  part_id   TEXT NOT NULL REFERENCES parts(part_id),
  month     TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  method    TEXT NOT NULL,
  value     NUMERIC(12, 4) NOT NULL,
  PRIMARY KEY (part_id, month, method)
);

CREATE TABLE shipments (
  shipment_id      TEXT PRIMARY KEY,
  part_id          TEXT NOT NULL REFERENCES parts(part_id),
  requested_qty    INTEGER NOT NULL CHECK (requested_qty > 0),
  dispatched_qty   INTEGER CHECK (dispatched_qty > 0),
  received_qty     INTEGER CHECK (received_qty >= 0),
  from_location    TEXT NOT NULL,       -- a location name or 'Supplier'
  to_location      TEXT NOT NULL REFERENCES locations(location_id),
  status           TEXT NOT NULL CHECK (status IN ('Requested', 'Dispatched', 'In Transit', 'Received')),
  requested_by     TEXT NOT NULL REFERENCES users(user_id),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_at      TIMESTAMPTZ NOT NULL,
  forecast_month   TEXT NOT NULL,
  review_note      TEXT NOT NULL,
  recommendation_id TEXT,
  created_live     BOOLEAN NOT NULL DEFAULT TRUE   -- false for the seeded baseline shipments
);
CREATE INDEX shipments_status_idx ON shipments(status);

CREATE TABLE shipment_events (
  event_id    BIGSERIAL PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id),
  status      TEXT NOT NULL CHECK (status IN ('Requested', 'Dispatched', 'In Transit', 'Received')),
  time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    TEXT NOT NULL REFERENCES users(user_id),
  tx_id       TEXT,
  note        TEXT
);
CREATE INDEX shipment_events_shipment_idx ON shipment_events(shipment_id);

-- Reporting copy of every ledger record, plus rejected attempts from the application layer
-- (source = 'application', never written to the ledger).
CREATE TABLE ledger_records (
  record_id    TEXT PRIMARY KEY,
  tx_id        TEXT UNIQUE,                  -- Fabric transaction id; NULL for application-level rejections
  shipment_id  TEXT NOT NULL,                -- not a foreign key: rejected attempts may name unknown shipments
  part_id      TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('REQUEST', 'DISPATCH', 'STATUS_CHANGE', 'RECEIPT', 'ATTEMPT')),
  quantity     INTEGER NOT NULL,
  org          TEXT NOT NULL,
  user_id      TEXT REFERENCES users(user_id),
  user_name    TEXT NOT NULL,
  block        BIGINT,
  status       TEXT NOT NULL CHECK (status IN ('Committed', 'Rejected')),
  source       TEXT NOT NULL CHECK (source IN ('chaincode', 'application')),
  failed_rule  TEXT,
  reason       TEXT,
  from_status  TEXT,
  to_status    TEXT,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_records_shipment_idx ON ledger_records(shipment_id);

CREATE TABLE alerts (
  alert_id        TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('Shortage', 'Discrepancy', 'Delay', 'Rejected attempt')),
  severity        TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL,
  part_id         TEXT REFERENCES parts(part_id),
  shipment_id     TEXT REFERENCES shipments(shipment_id),
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by TEXT REFERENCES users(user_id),
  resolution_note TEXT
);

-- Local development ledger (LEDGER_MODE=local). Used only when Fabric is not running;
-- it applies the same chaincode rules but has no endorsement, ordering or peers.
CREATE TABLE local_ledger_state (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
CREATE TABLE local_ledger_blocks (
  block     BIGSERIAL PRIMARY KEY,
  tx_id     TEXT NOT NULL UNIQUE,
  payload   JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
