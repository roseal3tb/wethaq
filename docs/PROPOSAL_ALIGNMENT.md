# Wethaq — proposal alignment and honest implementation status

This review uses the Fall 2026 Wethaq graduation proposal, product objectives P1–P7 and the Release 1–2 roadmap, not a generic admin-dashboard checklist

| Objective | This pull request / application | What remains beyond the web demonstration |
|---|---|---|
| P1 Authentication and roles | Demo sign-in, role switching, route guards, role-checked state mutations | Identity provider, server authorization and durable audit controls |
| P2 Demand forecasts | Precomputed offline results on the public RAF dataset (5,000 series, 78-month training, Jul–Dec 2002 test): naive, 12-month moving average, SES, Croston, SBA, TSB and a scikit-learn HistGradientBoostingRegressor with Poisson loss; MAE, RMSE, MASE, RMSSE, bias, forecast/actual and coverage; four-origin rolling evaluation. A separate synthetic SP-series view uses Naive, Croston and a labeled illustrative ML surrogate | Serve forecasts from the backend instead of static result files; no XGBoost model was trained |
| P3 Inventory/replenishment | Stock positions, assumptions, policy comparison from the offline simulation (a custom Python monthly loop; SimPy was not used), planner-reviewed recommendations and simulated request | Validate input provenance and replenish against verified data; no automatic purchasing |
| P4 Shipment records | Request → Dispatch → In Transit → Receipt, role-checked and shown in timeline | Integrate actual application data and authenticated participating organizations |
| P5 Permissioned ledger | **Simulated** rule engine for references, organizations, quantity, transitions and duplicate receipt, committed-vs-rejected display | **Not implemented**: actual Hyperledger Fabric test network, chaincode, endorsement/orderer connection and persistence |
| P6 Unified dashboard | Forecast, inventory, shipment and transaction views share the demonstration state | Integration tests with real forecast API and ledger gateway |
| P7 Alerts | Synthetic shortages, discrepancies and rejected-operation events with acknowledgment | Event-driven production alerts and operational alert delivery |

## Provenance and research limits

- The aviation-style demand histories are deterministic synthetic examples
- The proposal identifies a **separate civilian logistics dataset** for shipment evaluation and simulated custody events, which is not imported or validated in the current web-only demonstration
- Current cross-module part/shipment associations are illustrative constructed scenario links, **not real joined military or civilian operational records**
- A committed simulated ledger entry shows an accepted application event only; it does **not** independently verify physical arrival or cargo condition
- The ML candidate in the synthetic SP-series view is a deterministic seasonal-lag surrogate and is **not** a trained model; the gradient-boosting results on the RAF view come from scikit-learn HistGradientBoostingRegressor, **not** XGBoost
- The backend application service, the PostgreSQL database and the Hyperledger Fabric network and chaincode are designed but **not implemented**
- The 95% service level, lead times, stockout counts and replenishment policy results are modeling assumptions, not operational performance claims

## Academic release roadmap

**Release 1 / Sprints 1–3:** Synthetic data appraisal and roles; permitted dispatch/receipt actions and rejection rules; initial forecast baselines; local Fabric test network remains a separate required workstream

**Release 2 / Sprints 4–6:** Forecast/policy evaluation, reconciliation and full application integration; more comprehensive functional, usability and scenario tests; document limits and final validation

## UI improvements in this PR

- Midnight Navy / Light / System modes with persisted preference and visual tokens for tables, dialogs, navigation, charts and forms
- Times New Roman for editorial headings, Plus Jakarta Sans for controls and reading, JetBrains Mono for ledger hashes
- Six-step Guided Demo mapping the proposal flow from operational picture to forecasting, inventory, dispatch, receipt and ledger verification
- Rejected operations are logged as **ATTEMPT**, never represented as committed ledger transactions
- User role-management actions are guarded in the state layer; invalid spreadsheet formulas are escaped on CSV export
- User-facing copy avoids trailing sentence periods in headings, descriptions and notices

## Validation expectations

Vercel build and TypeScript status are verified from the actual preview deployment for the feature branch, but a visual regression, keyboard/screen-reader audit and real-device responsive test remain manual checks
