# Acceptance checklist / current implementation

| Requirement | Files and behavior | Status |
|---|---|---|
| Navy + olive design; supplied SVG logo | `src/styles.css`, `public/brand/` | Implemented in source |
| Demo login, 4 role types and restricted access | `Login.tsx`, `App.tsx`, `Store.tsx` | Implemented in source |
| Overview KPIs, risk and activity feeds | `Overview.tsx` | Implemented in source |
| 72-month history, 12-month holdout, model metrics | `data/mock.ts`, `data/forecast.ts`, `Forecasts.tsx` | Implemented; synthetic ML surrogate explicitly disclosed |
| 60 parts × 3 locations × 72 months | `data/mock.ts` | Verified: 12,960 records |
| Inventory table, drawer and request modal | `Inventory.tsx` | Implemented in source |
| Simulation policy comparison | `data/forecast.ts`, `Inventory.tsx` | Implemented as a local discrete monthly simulation |
| Planner request → dispatch → transit → receipt | `context/Store.tsx`, `Shipments.tsx` | Implemented in source; browser test recommended |
| Five invalid-operation rejection paths | `utils/core.ts`, `context/Store.tsx` | Logic validated in local checks |
| Ledger transaction details and copy actions | `Shipments.tsx` | Implemented in source |
| Admin users and permission matrix | `Users.tsx` | Implemented in source |
| Loading, empty, error and retry | `LoadGate.tsx`, `UI.tsx`, `api/index.ts` | Implemented in source |
| Charts with table alternative | `Forecasts.tsx` | Implemented for main forecast chart |
| Keyboard focus, modals, reduced motion | UI/Styles, Radix dialogs | Implemented in source; manual accessibility audit recommended |
| Responsive 390–1440px | `styles.css` | CSS breakpoints included; visual browser audit recommended |
| Tested production build and Lighthouse score | `npm run build`, Lighthouse | **Not verified** in offline authoring environment |

## Differences from the aspirational brief

- This is a **React/Vite/TypeScript + design-token CSS** project. No Tailwind build plugin is required. The brief permits CSS alternatives for central tokens, although it specifically suggested Tailwind or CSS Modules.
- There is **no connected Fabric network**. Transaction commits and endorsements are simulated and clearly marked.
- The ML candidate is a synthetic seasonal-lag surrogate rather than a trained XGBoost estimator; no actual model accuracy is claimed.
- The policy study is a lightweight deterministic demonstration, not a validated SimPy experiment.
- The simulated warehouse and shipment entities intentionally use constructed cross-module references.
- A true end-to-end browser/Lighthouse report has not been run due to the environment's blocked npm access. Run the project and inspect all states on your machine.
