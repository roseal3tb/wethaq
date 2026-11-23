# Wethaq — Consolidated UI/UX and Demo Data QA Refinement

**Source supplied:** `wethaq.zip` (frontend-only repository snapshot, `main` at `9ea316d`).
**Local implementation branch:** `feat/complete-ux-login-qa`.
**Scope:** This archive contains the standalone React/Vite **demonstration frontend** (`mockAPI` and browser session state), **not** the separate Express/PostgreSQL/Hyperledger Fabric backend or the offline RAF training scripts. Do not substitute it for a newer live-connected dashboard without checking differences.

## Applied changes (what is actually present)

| Area | Changes |
|---|---|
| Login | Four animated, accessible-as-decoration navy/olive workflow cards; separate wide-desktop and responsive mobile layouts; reduced-motion support. Email syntax validated by HTML and Store; demo password is `demo`, with clear demo-only copy. |
| Inventory shortage alerts | Derived from `computeInventory()` exactly like the inventory table. One stable alert per risky stock position, including SP-005 Distribution Center, SP-006 Deployment Site, and SP-035 Central Warehouse. Inbound stock explicitly shown separately; previously acknowledged alerts stay acknowledged, stale statuses don't linger. No server notifications created. |
| Ledger truthfulness | Removed synthetic 64-character pseudo-transaction hashes, including restored demo records. No rejected attempt has a committed block; missing Fabric hashes explicitly read `Not available · demo`. No cryptographic or backend evidence is claimed. Demo block sequence is labeled as such. |
| Data provenance | About, login, Guided Demo, and forecasting methodology distinguish SP-series synthetic UI from the public RAF offline study and its trained `HistGradientBoostingRegressor`. A `RAF0013` query explains that RAF series cannot be selected from synthetic SP-series data. |
| Forecast search | Search by SP part ID or name, Enter selects exact/unambiguous result, empty-results message; model overlay checkbox has an accessible name; glossary / metric help and clearer disclaimers. |
| Global search | Part ID/name, related shipment records, shipment ID, transaction ID, and transaction-related shipment/part. Keeps demo role restrictions from the existing app. |
| Inventory requests | Blank required review note (was prefilled), quantity string preserved during typing, negative/decimal/zero/overflow rejected; pending-shipment warnings; clearer planning month label, inline error text; removed redundant page-level inventory export. |
| Shipment flows | More visible dispatch/receipt quantity error, demonstration tools moved above shipment table, conceptual route limited to actual origin and destination, simulated endorsement labels. Existing transitions and validation engine retained. |
| Navigation | Unknown Inventory `?tab=` falls back to Inventory; client-side branded 404 plus Vercel SPA fallback. |
| Dark mode / tables | More legible table headers/cells, section headings, journey stages, chart labels, error states; sticky identifying first column, sticky status at mobile widths, high-contrast focus treatment. |
| Test updates | Added a shortage reconciliation data regression; updated E2E script for user-entered review notes, dynamic active-alert count and invalid login. |

## Verification in this environment

- **PASS**: TypeScript syntax parsing of source and test files; CSS parsing of all stylesheets (34 relevant files, no errors).
- **PASS**: Strict TypeScript type-check of `src/types.ts`, `src/utils/core.ts`, `src/data/mock.ts`, and `src/data/forecast.ts` (isolated domain modules; no third-party UI dependencies).
- **PASS 12/12**: Direct domain runtime smoke checks (mock dataset dimensions, preserved 48 shipments / 82 transactions, no fake hashes, computed shortage positions, acknowledgement, risk examples, simulated transfer math, permissions, forecasting splits, policy groups).
- **PASS**: `git diff --check` and `vercel.json` JSON parse.
- **VISUAL STATIC PREVIEW ONLY**: Screenshot of layout/styling at 390, 600, 768, 1024 and 1440 px with no card/headline overlap; sample screenshots under `docs/qa-previews/`. These are *static DOM/CSS mockups*, **not screenshots of a built React app**.
- **NOT RUN**: `npm run build`, `npm test` (Vitest) and `npm run test:ui` (Playwright). Node dependencies were not bundled with the user-supplied ZIP; package installation could not complete from this execution environment. Their pass/fail status must be verified on your local machine or CI.
- **NOT VERIFIED**: Live backend, Fabric ledger integration, real authenticated role enforcement, real data persistence, live route history or database reset behavior, actual live-browser usability study.

## Important limitations / follow-up

1. This ZIP has **only a demo frontend**. Do not interpret the absence of hashes as changing any actual Fabric history. A separate live-connected frontend and API may have different code and must be audited/tested independently.
2. Historical RAF/ML experiment outputs have **not** been edited. This archive does not include them.
3. The synthetic SP forecast page cannot display actual `RAF0013` time series; it now explains that boundary rather than inventing a linkage.
4. Demo's transaction identifiers and block-like sequences remain **illustrative**, not Fabric IDs. They are identified accordingly. A connected live product should consume genuine identifiers returned by the backend.
5. We did not rebuild the charts to add statistical models not calculated by this demo code (SBA or Zero), because doing so without verified corresponding data would be misleading.
6. Responsive and accessibility improvements need a real-app browser walkthrough and ideally an automated WCAG audit before final acceptance.
7. Do not reset demonstration data in the browser until you decide whether the test transactions should be retained. This ZIP modifies source only.

## Safe application — don't lose the original project

**Do not drag this directory on top of your current Git checkout.** The source snapshot may be older than the version on your Mac or the live-connected dashboard.

1. Back up or commit your current checkout, including any untracked work, **first**.
2. Extract `wethaq_complete_refinement.zip` into a **new directory**, not your working directory.
3. Review the local branch and diff against the supplied baseline: `git diff main..feat/complete-ux-login-qa --stat`.
4. If this ZIP is based on the same repository history as your current checkout, use `git cherry-pick <commit>` or merge the dedicated branch in a **separate test branch** and resolve conflicts deliberately; never force-push.
5. In a clean Node environment: `npm install`, `npm run build`, `npm test`, `npm run test:ui`. Run this prior to any deployment or pull request.
6. Test demo-mode session state and four roles; verify live services **only if you provide the matching live frontend/backend**.

This is a source-code deliverable and local commit, **not a published GitHub PR**. GitHub authentication and a working build/test environment are required to finish and publish the PR.
