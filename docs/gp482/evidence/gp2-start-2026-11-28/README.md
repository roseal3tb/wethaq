# Evidence: start of GP2 (28 November 2026)

Branch `gp2-start`, from `main` at `4d07717`. Code tested: commit `122eea4` (the commit after it adds only these
files and documentation). Everything below ran locally on Linux x86_64 with Node.js 22.23.5, Docker, PostgreSQL 16
and the pinned Fabric 2.5.12 test network. **The GitHub Fabric workflow and the arm64 workflow have not run on this
branch yet.**

## What was done

| Item | Change |
| --- | --- |
| B7 | `vite.config.ts` splits third-party code into vendor chunks |
| B16 | chaincode image on `node:22-bookworm-slim`; chaincode tests in CI on Node 22 |
| B5 | chaincode version 2.0.0 (cancel, partial receipt, return), API routes, migration 006, live-mode dashboard actions |

## Results

| Check | File | Result |
| --- | --- | --- |
| Chaincode tests | [chaincode-tests.txt](chaincode-tests.txt) | 34 passed (24 before, 10 new) |
| API tests, local ledger, in-process PostgreSQL | [api-tests.txt](api-tests.txt) | 116 passed, 9 skipped (the Fabric tests, run separately below) |
| Dashboard unit tests | [unit-tests.txt](unit-tests.txt) | 20 passed |
| Production build | [build.txt](build.txt) | largest chunk 442.11 kB (116.95 kB gzipped); no chunk-size warning. Before: one 951 kB chunk |
| Demo-mode browser tests | [demo-e2e.txt](demo-e2e.txt) | 58 passed, 2 skipped: demo mode unchanged |
| Live-mode browser tests | [live-e2e.txt](live-e2e.txt) | 10 passed, including the new test of all four new actions |
| Migration 006 on the existing database (81 shipments from version 1) | [migrate-006.txt](migrate-006.txt) | applied; no row had to change |
| Network before the upgrade | [verify-before.txt](verify-before.txt) | chaincode sequence 1, version 1.0 |
| Consistency before the upgrade | [consistency-before-upgrade.json](consistency-before-upgrade.json) | 81 of 81 shipments verified |
| Upgrade to version 2.0 | [upgrade-chaincode.txt](upgrade-chaincode.txt) | `WETHAQ_SKIP_CC_BUILD=1 ./fabric/upgrade-chaincode.sh 2.0`: sequence 2, approved by Org1MSP and Org2MSP, 24 s |
| Ledger history across the upgrade | [history-compare.txt](history-compare.txt) | SHP-2026-0001 and SHP-2026-0030 byte-identical |
| Consistency after the upgrade | [consistency-after-upgrade.json](consistency-after-upgrade.json) | 81 of 81 shipments verified |
| Fabric integration tests | [fabric-it.txt](fabric-it.txt) | 9 passed, including cancel, partial receipt, rejected over-receipt and return on Fabric |
| NFR checks on version 2.0 | [nfr.txt](nfr.txt) | 31 of 31 |
| Fabric browser test | [fabric-e2e.txt](fabric-e2e.txt) | 1 passed |
| Lint (`npx eslint .`, as in CI) | not stored | 0 errors, 113 warnings (106 before; the 7 new ones are `any` in the new API tests) |

The chaincode container reports Node.js v22.23.5 after the upgrade.

## Limits of this evidence

* **The local chaincode image was not built with `chaincode/shipment/Dockerfile`.** npm inside Docker cannot reach
  the registry in this sandbox (B11). The image was built from the runtime stage only, with dependencies installed
  on the host by `npm ci --omit=dev`: [local-chaincode-image.Dockerfile.txt](local-chaincode-image.Dockerfile.txt).
  The base image and the start command are the same as in the real Dockerfile. CI builds the real one.
* The GitHub `fabric.yml` and `oracle-arm64-readiness.yml` runs on this branch are still to be done (B5, B16).
* The new lifecycle is a proposal: Dispatcher (Org1) cancels, from Requested or Dispatched only; Receiver (Org2)
  records partial receipts and one return per shipment. It should be agreed with the supervisor.
* Nothing was deployed. Demo Mode on Vercel is unchanged and is not connected to any blockchain network.
