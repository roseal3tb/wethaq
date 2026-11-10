# Wethaq · Logistics Intelligence

![Wethaq](public/brand/wathaq-olive-lockup-dark.svg)

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

The **forecasting demonstration uses a naive baseline, a Croston estimator, and an explicitly labeled synthetic ML surrogate**. The surrogate is **not a trained XGBoost model**, because this is an interface demonstration. The synthetic policy comparison runs a simple local monthly discrete replenishment simulation, not a validated SimPy study. Figures have no claims about field performance.

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

### Future integration map

| Current mock module | Potential real source (later project phase) |
|---|---|
| `mockAPI.parts`, `.inventory`, `.shipments`, `.alerts`, `.users` | Express REST API → PostgreSQL |
| `mockAPI.forecast` | Python forecasting service via Express |
| `mockAPI.ledger` | Fabric Gateway SDK and reporting API |
| `validateOperation` + Store workflows | Server-authorized role checks and Fabric smart-contract validation |

Never treat browser-side role restrictions as actual security; real access control requires server enforcement in a future implementation. Mock operations are labeled honestly. Changing the API layer would also require moving state mutations into proper service operations; the current Store is explicitly demonstration-only.

## Brand and UI

- Navy `#0F2A44`, olive `#8A9A4B`, deep olive `#5F6B32` (no bright mint/emerald).
- Fully rounded cards, buttons, controls, dialogs and drawers; subtle hover and focus animations; reduced-motion support.
- Fluid responsive design at 1440, 1280, 1024, 768 and 390 px targets.
- Charts use Recharts for React integration and responsive, accessible tabular alternatives.
- Native semantic tables, labels, keyboard selection, Radix dialog focus handling, accessible focus rings.

## Important caveats

This is an **academic prototype using synthetic data only**. No real, classified, or operational military data is present. Forecasts and inventory recommendations are decision-support material, not purchase commands. The mock ledger is a demonstration of transaction rules, **not a connected Hyperledger Fabric network**, and even a real committed ledger record would not independently prove physical delivery or cargo condition. Modeled stockout conditions and lead-time estimates are assumptions, not field observations. No fabricated operational savings or performance claims are made.

**Build/testing note:** Source syntax, core TypeScript types, dataset sizes and rule-engine behavior were locally checked while preparing this repository. In the authoring environment, external npm registry access was unavailable, so a full dependency install, browser interaction suite, and Lighthouse assessment could not be completed there. Run `npm install`, `npm run build`, and `npm test` on a network-connected development machine before your committee demonstration.
