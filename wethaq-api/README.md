# Wethaq API

Application service for Wethaq (GP482): Express + PostgreSQL, with the shipment rules enforced by the ledger.
It implements the routes that the dashboard's live client already calls (`src/api/live.ts`, Appendix E of the GP481 report).

| Part | Where |
|---|---|
| Routes | `src/app.ts` |
| Relational schema (Figure 4.10) | `migrations/001_init.sql` |
| Shipment workflow | `src/services/shipments.ts` |
| Ledger submission, synchronization and reconciliation | `src/services/operations.ts` |
| Inventory positions and alerts | `src/services/inventory.ts` |
| Analysis results | `src/services/analytics.ts` |
| OpenAPI 3 document (also at `/api/openapi.json`) | `openapi.json` |
| The five transaction rules (shared with the chaincode) | `../chaincode/shipment/src/rules.ts` |
| Ledger adapters | `src/ledger/` |
| Demonstration data (same as the dashboard's) | `src/seed.ts` |

## Ledger modes

* `LEDGER_MODE=local` (default): a **development ledger** stored in PostgreSQL. It applies the same chaincode rules and keeps an append-only transaction list, but it has no peers, endorsement or ordering. It exists so the API can be built and tested before Fabric runs. It must not be described as Hyperledger Fabric.
* `LEDGER_MODE=fabric`: the Hyperledger Fabric test network through the Fabric Gateway SDK. Start the network with `../fabric/up.sh` first (see `../fabric/README.md`).

## Run it locally

Needs Node 22 and Docker Desktop.

```bash
cd wethaq-api
npm install
cp .env.example .env
npm run db:up        # PostgreSQL in Docker on port 5434
npm run setup        # create tables and load the demonstration data
npm run dev          # API on http://127.0.0.1:4000/api
```

For a quick look without Docker: `npm run dev:memory` starts the API with an in-memory database and freshly seeded data (nothing is saved).

In a second terminal, from the repository root:

```bash
npm run dev:live     # dashboard in live mode; /api is proxied to port 4000
```

Sign in with `planner@wethaq.demo`, `dispatcher@wethaq.demo`, `receiver@wethaq.demo` or `admin@wethaq.demo` and the `DEMO_PASSWORD` from `.env` (default `demo`).

To start again from the seeded data: `npm run seed -- --reset`.

## Tests

```bash
npm test             # 58 tests; uses an in-process PostgreSQL (PGlite), no Docker needed
npm run test:fabric  # 7 tests against the running Fabric network and API (LEDGER_MODE=fabric)
npm run check        # type check
```

The chaincode has its own tests (`cd ../chaincode/shipment && npm install && npm test`), and the dashboard's
live-mode browser tests run from the repository root with `npm run test:live`.

## How an operation is processed

1. The API checks the user's role (application layer). A refused operation is recorded in PostgreSQL only, with `source = application`, and the response is HTTP 422.
2. Otherwise the operation is submitted to the ledger as the user's peer organization (Dispatcher → Org1, Receiver → Org2). The chaincode applies the five rules in priority order.
3. An accepted operation changes the shipment's ledger state. A rejected one leaves it unchanged, but the attempt is still written to the ledger with its failed rule.
4. PostgreSQL is updated from the committed ledger record, once (shipment, event, reporting copy of the record, stock levels, alerts). A rejection returns HTTP 422 with `source = chaincode`.
5. If the ledger gives no confirmed answer: a certain failure returns 503 (not reachable), 502 (not endorsed) or 409 (invalidated) and nothing changes; an unknown outcome (submit or commit timeout) returns **202** with `pending: true`, and the event consumer or the reconciler applies the real result later.

Every submission is first written to `ledger_operations` with its Fabric transaction id. Send an `Idempotency-Key` header to make a retry safe: a repeat returns the stored result. Administrators can see the synchronization state at `GET /api/admin/sync-status` and run `POST /api/admin/reconcile`.

`GET /api/shipments/:id/verify` compares the PostgreSQL copy with the ledger state and returns `status`:
`verified`, `mismatch` (with the differences), `not_found`, `pending`, `ledger_unavailable` or `failed`.

## Production settings

With `NODE_ENV=production` the API refuses to start unless `JWT_SECRET` is at least 32 random characters, refuses
`DEMO_PASSWORD`, turns off role switching and the demonstration tools, and requires `CORS_ORIGIN` to name one origin.
Other settings: `RECONCILE_INTERVAL_MS` (default 30000), `PENDING_EXPIRY_MS` (300000), `LOG_LEVEL` (info), `DEMO_TOOLS`.
Logs are JSON lines with a request id; password, token, secret and key fields are redacted. The audit log is at
`GET /api/admin/audit`.

A container image: `docker build -f wethaq-api/Dockerfile -t wethaq-api .` from the repository root, or
`docker compose --profile api up -d --build` here (set `JWT_SECRET` first).

## Accounts and passwords

* Passwords are stored as bcrypt hashes. A password chosen by a user needs 8 to 128 characters with at least one letter and one digit.
* An administrator who adds a user, or resets a user's password, receives a one-time temporary password (shown once).
  It must be changed at first sign-in (until then every other route answers 403 `PASSWORD_CHANGE_REQUIRED`), and it
  stops working after `TEMP_PASSWORD_HOURS` hours (default 24), at sign-in and for open sessions.
* Any signed-in user can change their password from the key icon in the dashboard header.

## Live updates

`GET /api/events` is a server-sent event stream. It sends an event for every transaction committed on the ledger
(in Fabric mode, from the chaincode events of each block, so transactions from any client of the network appear)
and for every change to PostgreSQL (acknowledged alerts, user changes, application-level rejections). The dashboard
reads it with `fetch`, so the token stays in the Authorization header, and reloads its data when an event arrives.

## NFR measurements

With the API running (`npm run dev`), in a second terminal:

```bash
npm run nfr                                    # 10 workflow runs, 20 concurrent requests
npm run nfr -- --runs 30 --concurrency 50      # larger run
```

It measures response times for each workflow step and the throughput of concurrent requests, and checks security
(tokens, roles, password storage, headers), integrity (verification, a tampered database copy, an append-only history)
and reliability (the five smart-contract rules). Results go to `nfr-results/` as Markdown and JSON. It creates and
completes real shipments (review note "NFR test run"), so run it on demonstration data.

## Routes

| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone (10 attempts per minute) |
| GET | `/api/auth/me` | signed in (also with a temporary password) |
| POST | `/api/auth/password` | signed in (also with a temporary password; 10 attempts per minute) |
| GET | `/api/events` | signed in (server-sent events) |
| POST | `/api/auth/switch` | signed in, when `DEMO_ROLE_SWITCH=true` |
| GET | `/api/state` | signed in (other users are listed for Admin only) |
| GET | `/api/inventory` | signed in |
| POST | `/api/shipments` | Planner |
| POST | `/api/shipments/:id/dispatch` · `/transit` · `/receive` | Dispatcher / Dispatcher / Receiver |
| GET | `/api/shipments/:id/verify` | signed in |
| POST | `/api/demo/invalid` | signed in, when demo tools are on (never in production) |
| POST | `/api/alerts/:id/ack` | signed in |
| POST | `/api/users` · PATCH `/api/users/:id` · POST `/api/users/:id/reset-password` | Admin |
| GET | `/api/health` · `/api/health/live` · `/api/health/ready` · `/api/openapi.json` | anyone |
| GET | `/api/analytics` · `/api/analytics/:name` | signed in |
| GET | `/api/analytics/v1/datasets` · `/methods` · `/parts` · `/parts/:id/forecast` · `/metrics` · `/classification` · `/model-comparison` · `/rolling` · `/inventory-simulation` · `/inventory-policies` · `/provenance` (filters in `openapi.json`) | signed in |
| GET | `/api/admin/sync-status` · `/api/admin/audit` · POST `/api/admin/reconcile` | Admin |
