# Wethaq · Logistics Intelligence

![Wethaq](public/brand/wethaq-logo-dark.png)

**A React + TypeScript academic demonstration of military logistics planning, inventory recommendations, simulated supply movements, and permissioned-ledger-style transaction validation.**

Designed for the King Saud University GP481 graduation project. The interface is English/LTR; authentic olive-and-navy Arabic brand assets are included in `public/brand/`.

## Run locally

Requires **Node.js 20.19+ (or Node 22+)** and internet access **for the initial dependency installation**.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Other commands:

```bash
npm run build       # TypeScript verification and production assets
npm run preview     # Serve the built application
npm test            # Vitest tests for data, metrics, permissions and transaction checks
npm run check       # TypeScript type checking
```

The repository contains complete application source files; **`node_modules` is intentionally excluded**. There are no runtime network requests for dashboard data. Browser font fallbacks are provided.

## Live mode: API, PostgreSQL and Hyperledger Fabric (GP482)

Demo mode above runs entirely in the browser and is what the Vercel site shows. Live mode connects the same
dashboard to the Wethaq API (`wethaq-api/`: Express, PostgreSQL) and a Hyperledger Fabric 2.5 test network
(`fabric/`, chaincode in `chaincode/shipment/`). It needs Docker.

```bash
./fabric/install.sh && ./fabric/up.sh              # once: Fabric test network with CAs, channel, chaincode, identities
cd wethaq-api && npm install && cp .env.example .env # set LEDGER_MODE=fabric in .env
npm run db:up && npm run migrate && npm run seed -- --reset && npm run dev
cd .. && npm run dev:live                          # dashboard in live mode on http://localhost:5173
```

Documentation is in [`docs/gp482/`](docs/gp482/):
* [final completion report](docs/gp482/FINAL_COMPLETION_REPORT.md) and [remaining blockers](docs/gp482/REMAINING_BLOCKERS.md);
* [requirements traceability](docs/gp482/REQUIREMENTS_TRACEABILITY.md) and [test report](docs/gp482/FINAL_TEST_REPORT.md);
* [architecture](docs/gp482/ARCHITECTURE.md), [deployment guide](docs/gp482/DEPLOYMENT_GUIDE.md),
  [backup and recovery](docs/gp482/BACKUP_AND_RECOVERY.md) and [security review](docs/gp482/SECURITY_AUDIT.md);
* [differences from the GP481 report](docs/gp482/REPORT_DISCREPANCIES.md).

The API is described by `wethaq-api/openapi.json`, which it also serves at `/api/openapi.json`. Settings are
documented in `.env.example`, `wethaq-api/.env.example` and `deploy/production.env.example`. Nothing has been
deployed to a hosted server; `deploy/` holds a prepared single-server configuration.

## Demo sign-in

The login page is a simulated credential experience. Select a demonstration role, use any nonempty email/username and any nonempty password except `wrong`, then sign in. Starter values: `planner@wethaq.demo` / `demo`.

Switch roles any time from the header:

| Role | Demonstration capabilities |
|---|---|
| Logistics Planner | Overview, forecasts, inventory, shipment/ledger read access; create simulated requests |
| Dispatcher | Same read access as Planner; record dispatch and In Transit updates |
| Receiver | Overview, inventory/alerts, shipment/ledger read access; confirm receipts |
| Admin | Read all modules, manage demonstration users; no operational shipment write privileges |

See [the flagship walkthrough](docs/DEMO_WALKTHROUGH.md) for a complete 4-role demonstration.

## Pages

| Route | Functionality |
|---|---|
| `/login` | Split-screen login with brand artwork, role selection, validation, and password visibility |
| `/overview` | Five KPIs, forecast snapshot, shortage-risk list, shipment distribution, ledger feed, active alerts |
| `/forecasts` | Part, demand class, location, horizon filtering; historical/holdout/forecast visualization, three models, computed MAE/MASE/Bias, class comparisons, data download |
| `/inventory` | 180 stock positions, filters, sortable and configurable columns, CSV export, detail drawer, planner request, policy comparison, acknowledgable alerts |
| `/shipments` | Shipment list, detailed vertical journey, dispatch/transit/receipt validation, rejected-operation demos; separate ledger explorer with transaction details |
| `/users` | Admin-only demonstration user management, role editing, status confirmation, permissions matrix |

## Synthetic dataset

- 60 aviation-style spare parts, `SP-001` to `SP-060`; Smooth, Erratic, Intermittent and Lumpy demand classes.
- 3 fictional logistics locations and **72 months** of seeded monthly demand per part/location (**12,960 records**).
- 180 inventory records with modeled lead time, demand, reorder point and safety stock.
- 48 starting shipments spanning Requested, Dispatched, In Transit and Received.
- 72 starting committed transaction records and 10 rejected attempts.
- 13 starting shortage, delay, and discrepancy alerts.
- 8 fictional user identities.

All generated records are deterministic across reloads until the demo session changes them. Interactions are persisted to `sessionStorage`; selected role is stored in `localStorage` with exception handling. To start fresh, clear site data or session storage.

The **Demand Forecasting page shows precomputed offline results on the public RAF dataset** (including scikit-learn HistGradientBoostingRegressor with Poisson loss, not XGBoost) and a separate **synthetic SP-series view** with a naive baseline, a Croston estimator, and an explicitly labeled synthetic ML surrogate. The surrogate is **not a trained model**, because that view is an interface demonstration. The synthetic policy comparison runs a simple local monthly discrete replenishment simulation, not a validated SimPy study. Figures have no claims about field performance.

The proposal distinguishes a synthetic aviation demand dataset from a separate synthetic civilian shipment dataset. The cross-module journey is a documented constructed scenario, **not a reconstructed real transfer**.

## Architecture

```
public/brand/                 authentic original Wethaq SVG assets
src/
  api/index.ts                typed async mock data access; Promise-returning functions
  components/Charts.tsx      reusable Recharts visualizations
  components/UI.tsx          accessible button, table, drawer, modal and design primitives
  components/LoadGate.tsx    loading/error/retry route state
  context/Store.tsx          roles, demo workflows, notifications, persistence
  data/mock.ts               deterministic parts, demand, inventory, shipment, ledger generators
  data/forecast.ts           forecasting, metric calculations and policy simulations
  pages/                      Login, Overview, Forecasts, Inventory, Shipments, Users
  types.ts                   shared domain types
  utils/core.ts              formatting, CSV, permissions and validation rules
  styles.css                 centralized navy/olive tokens and responsive design
  App.tsx                    navigation, guarded routes and application shell
tests/                        unit tests
docs/                         demo walkthrough, acceptance matrix, design guidelines
```

### Integration (GP482)

| Demo-mode module | Live mode |
|---|---|
| `mockAPI.parts`, `.inventory`, `.shipments`, `.alerts`, `.users` | Express REST API → PostgreSQL (`wethaq-api`) |
| `mockAPI.forecast` | the offline Python analysis's result files, served by the API with checksums (`/api/analytics`) |
| `mockAPI.ledger` | Fabric Gateway SDK → Hyperledger Fabric (`chaincode/shipment`) |
| `validateOperation` + Store workflows | server-side role checks in the API and the same rules in the chaincode |

In demo mode the browser-side role restrictions are a demonstration, not security. In live mode every request is
authorized by the API, and every shipment operation is validated by the chaincode and endorsed by both organizations.

## Brand and UI

- Navy `#0F2A44`, olive `#8A9A4B`, deep olive `#5F6B32` (no bright mint/emerald).
- Fully rounded cards, buttons, controls, dialogs and drawers; subtle hover and focus animations; reduced-motion support.
- Fluid responsive design at 1440, 1280, 1024, 768 and 390 px targets.
- Charts use Recharts for React integration and responsive, accessible tabular alternatives.
- Native semantic tables, labels, keyboard selection, Radix dialog focus handling, accessible focus rings.

## Important caveats

This is an **academic prototype using synthetic data only**. No real, classified, or operational military data is present. Forecasts and inventory recommendations are decision-support material, not purchase commands. In demo mode the ledger is a demonstration of transaction rules, **not a connected Hyperledger Fabric network**; live mode uses a real Fabric test network on one machine. Even a committed ledger record does not independently prove physical delivery or cargo condition. Modeled stockout conditions and lead-time estimates are assumptions, not field observations. No fabricated operational savings or performance claims are made.

**Testing:** the results of the latest run of every suite (unit, API, chaincode, browser in demo and live mode, and on Fabric) are in [docs/gp482/FINAL_TEST_REPORT.md](docs/gp482/FINAL_TEST_REPORT.md). In the first GitHub Actions run, every job passed except the database dump step, which has since been fixed.
