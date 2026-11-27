# GP1 final regression run, 2026-11-27

Run in the development environment (Linux x86-64, 4 vCPU, 16 GB, Node v22.23.5, Docker 29.9.3,
PostgreSQL 16) on branch `gp1-final-readiness` at commit `4e134e7` (the last code change; later commits on the
branch change documentation only).

| Suite | Command | Result |
| --- | --- | --- |
| Dashboard unit tests | `npm test` | 20 passed |
| Lint | `npx eslint .` (pinned tool chain from `checks.yml`) | 0 errors, 106 warnings |
| Type check and build, Demo Mode | `npm run build` | passed |
| Type check and build, live mode | `npm run build:live` | passed |
| CSP hash | `node deploy/check-csp-hash.mjs` | the Caddyfile allows the 1 inline script |
| Chaincode unit tests | `cd chaincode/shipment && npm test` | 24 passed |
| API type check | `cd wethaq-api && npx tsc --noEmit -p .` | passed |
| API tests | `cd wethaq-api && npx vitest run` | 109 passed, 7 skipped (the Fabric suite, run separately below) |
| Browser tests, Demo Mode, 4 viewports | `npx playwright test` | 54 passed, 2 skipped |
| Browser tests, live mode | `npx playwright test -c playwright.live.config.ts` | 9 passed |
| Fabric network check | `./fabric/verify-network.sh` | 14 of 14 ok (`verify-network.txt`) |
| Fabric integration | `npm run test:fabric` (API in Fabric mode) | 7 passed |
| Non-functional checks | `sleep 65 && npm run nfr` | **31 of 31**, exit code 0 (`nfr-2026-11-27T23-16-32.md` / `.json`) |
| Fabric browser test | `npx playwright test -c playwright.fabric.config.ts` | 1 passed |

`regression-summary.txt` holds the summary lines of each run.

**First Fabric attempt failed, for a known reason.** The first attempt seeded a ledger that had already been
seeded once, so the chaincode refused to create SHP-2026-0001 to 0010 a second time ("already exists"), the seed
stopped, and 5 of 7 integration tests and 7 of 24 NFR checks then failed. That is the documented behaviour: a
reseed needs a fresh network (`./fabric/up.sh`). After `./fabric/up.sh`, `npm run seed -- --reset` and the
steps above, everything passed. That failed attempt also showed the NFR fix working: `npm run nfr` reported
"17 of 24 checks passed" and **exited 1** (before the fix it exited 0).

The accessibility check is in `accessibility/`.
