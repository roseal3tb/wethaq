# Wethaq API

Application service for Wethaq (GP482): Express + PostgreSQL, with the shipment rules enforced by the ledger.
It implements the routes that the dashboard's live client already calls (`src/api/live.ts`, Appendix E of the GP481 report).

| Part | Where |
|---|---|
| Routes | `src/app.ts` |
| Relational schema (Figure 4.10) | `migrations/001_init.sql` |
| Shipment workflow and ledger submission | `src/services/shipments.ts` |
| The five transaction rules (shared with the chaincode) | `../chaincode/shipment/src/rules.ts` |
| Ledger adapters | `src/ledger/` |
| Demonstration data (same as the dashboard's) | `src/seed.ts` |

## Ledger modes

* `LEDGER_MODE=local` (current default): a **development ledger** stored in PostgreSQL. It applies the same chaincode rules and keeps an append-only transaction list, but it has no peers, endorsement or ordering. It exists so the API can be built and tested before Fabric runs. It must not be described as Hyperledger Fabric.
* `LEDGER_MODE=fabric`: the Hyperledger Fabric test network through the Fabric Gateway SDK (added in the next stage).

## Run it locally

Needs Node 22 and Docker Desktop.

```bash
cd wethaq-api
npm install
cp .env.example .env
npm run db:up        # PostgreSQL in Docker on port 5433
npm run setup        # create tables and load the demonstration data
npm run dev          # API on http://127.0.0.1:4000/api
```

In a second terminal, from the repository root:

```bash
npm run dev:live     # dashboard in live mode; /api is proxied to port 4000
```

Sign in with `planner@wethaq.demo`, `dispatcher@wethaq.demo`, `receiver@wethaq.demo` or `admin@wethaq.demo` and the `DEMO_PASSWORD` from `.env` (default `demo`).

To start again from the seeded data: `npm run seed -- --reset`.

## Tests

```bash
npm test             # 33 tests; uses an in-process PostgreSQL (PGlite), no Docker needed
npm run check        # type check
```

## How an operation is processed

1. The API checks the user's role (application layer). A refused operation is recorded in PostgreSQL only, with `source = application`, and the response is HTTP 422.
2. Otherwise the operation is submitted to the ledger as the user's peer organization (Dispatcher → Org1, Receiver → Org2). The chaincode applies the five rules in priority order.
3. An accepted operation changes the shipment's ledger state. A rejected one leaves it unchanged, but the attempt is still written to the ledger with its failed rule.
4. PostgreSQL is updated from the ledger result (shipment, event, reporting copy of the record, stock levels, alerts). A rejection returns HTTP 422 with `source = chaincode`.

`GET /api/shipments/:id/verify` compares the PostgreSQL copy with the ledger state and lists any differences.

## Routes

| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone (10 attempts per minute) |
| GET | `/api/auth/me` | signed in |
| POST | `/api/auth/switch` | signed in, when `DEMO_ROLE_SWITCH=true` |
| GET | `/api/state` | signed in (other users are listed for Admin only) |
| GET | `/api/inventory` | signed in |
| POST | `/api/shipments` | Planner |
| POST | `/api/shipments/:id/dispatch` · `/transit` · `/receive` | Dispatcher / Dispatcher / Receiver |
| GET | `/api/shipments/:id/verify` | signed in |
| POST | `/api/demo/invalid` | signed in |
| POST | `/api/alerts/:id/ack` | signed in |
| POST | `/api/users` · PATCH `/api/users/:id` | Admin |
| GET | `/api/health` | anyone |
