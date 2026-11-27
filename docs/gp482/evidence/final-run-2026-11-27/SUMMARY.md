# Final verification run — 2026-11-27 (UTC)

Development container: Linux x64, Node 22.23.5, npm 10.9.9, Docker 27, PostgreSQL 16 (`DATABASE_URL` pointing at a
local server on port 5432), Hyperledger Fabric 2.5.12 test network with Fabric CA 1.5.15, chaincode `wethaq` 1.0
sequence 1, application identities renewed with `renew-identities.sh` before this run. All steps ran one after the
other from `/tmp/final/run.sh`; each log is next to this file. No step failed.

| Step | Directory | Command | Duration | Exit code |
|---|---|---|---|---|
| root-check | `.` | `npm run check` | 5s | 0 |
| root-test | `.` | `npm test` | 0s | 0 |
| root-build | `.` | `npm run build` | 9s | 0 |
| api-check | `wethaq-api` | `npm run check` | 2s | 0 |
| api-test | `wethaq-api` | `npm test` | 11s | 0 |
| chaincode-test | `chaincode/shipment` | `npm test` | 1s | 0 |
| audit-root | `.` | `npm audit` | 0s | 0 |
| audit-api | `wethaq-api` | `npm audit` | 1s | 0 |
| audit-chaincode | `chaincode/shipment` | `npm audit` | 0s | 0 |
| mermaid | `.` | `node /tmp/mm/check.mjs docs/gp482/ARCHITECTURE.md docs/gp482/DEPLOYMENT.md docs/gp482/DIAGRAMS.md` | 2s | 0 |
| ui-demo | `.` | `npx playwright test` | 154s | 0 |
| ui-live | `.` | `npx playwright test -c playwright.live.config.ts` | 35s | 0 |
| fabric-verify | `.` | `./fabric/verify-network.sh` | 1s | 0 |
| ui-fabric | `.` | `npx playwright test -c playwright.fabric.config.ts` | 29s | 0 |
| nfr | `wethaq-api` | `LEDGER_MODE=fabric npm run nfr` | 27s | 0 |
| api-fabric | `wethaq-api` | `LEDGER_MODE=fabric npm run test:fabric` | 4s | 0 |

Counts:

| Suite | Passed | Failed | Skipped | Why skipped |
|---|---|---|---|---|
| Dashboard unit tests (Vitest 4.1.12) | 20 | 0 | 0 | |
| API tests (Vitest 4.1.12, PGlite, local development ledger) | 71 | 0 | 7 | the Fabric suite runs only with `FABRIC_IT=1` (run separately below) |
| Chaincode unit tests | 24 | 0 | 0 | |
| Demo-mode browser tests (Playwright, 4 viewports) | 54 | 0 | 2 | the mobile-navigation test is skipped on the tablet and desktop viewports (`test.skip` when wider than 760 px) |
| Live-mode browser tests (API in memory, local development ledger) | 6 | 0 | 0 | |
| Fabric browser test (17 steps) | 1 | 0 | 0 | step timings in `ui-fabric-steps.txt` |
| Fabric integration suite | 7 | 0 | 0 | |
| NFR checks on Fabric | 31 | 0 | 0 | report in `nfr-report.md` |
| `verify-network.sh` | 14 ok | 0 | — | |
| `npm audit` (3 projects) | 0 vulnerabilities each | | | |
| Mermaid diagrams parsed with Mermaid 11 (`check-mermaid.mjs`) | 10 | 0 | | |

`check-mermaid.mjs` is the one-off checker used here: it loads Mermaid 11 (installed in a scratch folder) into
Playwright's Chromium and calls `mermaid.parse` on every Mermaid block.
