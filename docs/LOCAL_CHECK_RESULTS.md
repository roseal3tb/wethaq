# Local source verification (offline authoring environment)

Verification performed during package preparation:

| Check | Observed result |
|---|---|
| TypeScript/TSX syntax parsing | 19 source + test files, 0 parsing errors |
| Pure domain-module strict TypeScript check | Completed with no errors (`types.ts`, `data/*.ts`, `utils/core.ts`) |
| Spare-part count | 60 |
| Monthly synthetic demand records | 12,960 |
| Inventory positions | 180 |
| Starting shipments | 48 |
| Starting ledger transactions + attempts | 82 |
| Starting alerts | 13 |
| Starting fictional users | 8 |
| Simulated dispatch valid case | Passed |
| Unauthorized and duplicate receipts | Rejected with correct rule |
| Excess receipt quantity | Rejected |
| Forecast holdout and forecast point lengths | Passed |
| Policy simulation output bounds | Passed |

**Not yet verified:** complete `npm install`, Vite production build, Vitest runner, live browser UI behavior, visual screenshots, accessibility audit, Lighthouse measurement.

The environment could not resolve `registry.npmjs.org`, preventing dependency installation. The repository is intended to be opened on a network-connected machine for final build and UI review.
