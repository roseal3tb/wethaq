# Wethaq: requirements traceability

Status as of 2026-11-27, branch `gp482-final`. The test results are those of the final run in
[FINAL_TEST_REPORT.md](FINAL_TEST_REPORT.md). The final report is [FINAL_COMPLETION_REPORT.md](FINAL_COMPLETION_REPORT.md).

Status labels:
* **COMPLETE AND VERIFIED**: implemented, and the verification named in the row was run and passed.
* **IMPLEMENTED BUT NOT VERIFIED**: the code exists, but the verification could not be run here.
* **PARTIALLY COMPLETE**: part of the requirement is done; the rest is named under *Remaining work*.
* **BLOCKED**: needs something outside the code; see [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md).
* **NOT APPLICABLE**: does not apply to this system.

Abbreviations: *API tests* = `wethaq-api` vitest (109 passed); *chaincode tests* = 24 passed; *demo e2e* = 54
passed; *live e2e* = 9 passed; *Fabric e2e* = the full workflow on Fabric (1 passed); *Fabric IT* = Fabric
integration (7 passed); *NFR* = 31 of 31 on Fabric.

## 1. GP481 functional requirements (Table 4.4)

| Requirement | Implementation location | Current status | Verification method | Test result | Remaining work |
| --- | --- | --- | --- | --- | --- |
| FR1 sign-in, access by role | `wethaq-api/src/auth.ts`, `app.ts`; `src/api/live.ts` | COMPLETE AND VERIFIED | API tests (auth, sessions); NFR security checks; live e2e | passed | — |
| FR2 monthly forecast with error measures | `analysis/`, `services/analytics.ts`, `/api/analytics/v1/parts/:id/forecast`, `Forecasts.tsx` | COMPLETE AND VERIFIED | analytics tests; reproduction of the analysis; live e2e checks file and SHA-256 | passed; outputs identical | forecasts are precomputed, not live |
| FR3 compare methods | `/api/analytics/v1/metrics`, `model-comparison`, `rolling` | COMPLETE AND VERIFIED | analytics tests | passed | — |
| FR4 stock on hand, in transit, reorder point, status | `services/inventory.ts`, `/api/inventory`, `Inventory.tsx` | COMPLETE AND VERIFIED | sync tests (applied once per transaction); live e2e; Fabric e2e | passed | data is synthetic (Dataset C) |
| FR5 replenishment recommendation reviewed before a request | `Inventory.tsx` request form; `createShipment` validation | COMPLETE AND VERIFIED | demo e2e; live e2e; Fabric e2e | passed | — |
| FR6 planner creates a request | `services/shipments.ts` `createShipment`; chaincode `RegisterRequest` | COMPLETE AND VERIFIED | API tests; Fabric IT; Fabric e2e | passed | — |
| FR7 dispatch, in transit, receipt | `operate`, chaincode `Dispatch`, `MarkInTransit`, `Receive` | COMPLETE AND VERIFIED | chaincode tests; Fabric IT; Fabric e2e; NFR workflow 10 of 10 | passed | — |
| FR8 rules before recording; rejection recorded with reason | `chaincode/shipment/src/rules.ts`, `contract.ts` | COMPLETE AND VERIFIED | chaincode tests (each rule rejected); Fabric IT; NFR *second receipt refused* | passed | — |
| FR9 accepted operations on a permissioned ledger, verifiable | Fabric Gateway `ledger/fabric.ts`; `VerifyShipment`; `/shipments/:id/verify`; `/admin/consistency` | COMPLETE AND VERIFIED | Fabric IT; Fabric e2e (checked on the peer with `fabric/query.sh`); consistency drill | passed | — |
| FR10 one dashboard | `src/pages/*` (unchanged design) | COMPLETE AND VERIFIED | demo e2e; live e2e | passed | — |
| FR11 alerts and acknowledgement | `services/inventory.ts` `raiseAlert`, `/alerts`; `Inventory.tsx` | COMPLETE AND VERIFIED | API tests (dedupe, pending, sync); demo e2e at 4 sizes | passed | — |
| FR12 administrator manages users and roles | `services/users.ts`, `/users`; `services/bootstrap.ts` | COMPLETE AND VERIFIED | API tests (account, sessions, bootstrap); NFR role checks | passed | — |

## 2. GP481 non-functional requirements (Table 4.5)

| Requirement | Implementation location | Current status | Verification method | Test result | Remaining work |
| --- | --- | --- | --- | --- | --- |
| NFR1 usability at four screen sizes | dashboard CSS (unchanged) | COMPLETE AND VERIFIED | demo e2e at 390, 430, 768, 1440 px | 54 passed | — |
| NFR2 accessibility | dashboard (unchanged) | PARTIALLY COMPLETE | keyboard and focus tests in demo e2e | passed | full audit (B8) |
| NFR3 transparency | live ledger wording; analytics provenance and `check` | COMPLETE AND VERIFIED | live e2e; analytics-files tests | passed | — |
| NFR4 CSV without formulas | `src/utils` export | COMPLETE AND VERIFIED | dashboard unit tests; demo e2e | passed | — |
| NFR5 passwords and tokens protected, server authorization | `auth.ts`, `config.ts`, `app.ts`, migration 005 | COMPLETE AND VERIFIED | NFR (17 security checks); sessions tests; SECURITY_AUDIT.md | passed | open findings F5 to F13 |
| NFR6 accepted record cannot be changed | Fabric ledger; chaincode `noDuplicate`; verification | COMPLETE AND VERIFIED | NFR integrity checks (5) | passed | — |
| NFR7 performance | measured by `wethaq-api/src/cli/nfr.ts` | COMPLETE AND VERIFIED (one machine) | NFR performance checks | 543 ms average write; 115 ms p95 reads; 76.2 tx/s | not a capacity test |

## 3. GP482 completion areas

| Requirement | Implementation location | Current status | Verification method | Test result | Remaining work |
| --- | --- | --- | --- | --- | --- |
| Fabric test network, 2 organizations, CA, channel `wethaq`, endorsement by both | `fabric/up.sh`, `lib.sh` | COMPLETE AND VERIFIED | `verify-network.sh` | 14 of 14 ok | production network (F11) |
| Network scripts: start, stop, upgrade, reset, query | `fabric/*.sh` | COMPLETE AND VERIFIED | run on the real network (start waits for the orderer leader) | ok | — |
| Application identities per organization; renewal | `enroll-identities.sh`, `renew-identities.sh` | COMPLETE AND VERIFIED | renewal on both organizations, then commits and the Fabric e2e | passed | — |
| Identity revocation with CRL in the channel MSP | `fabric/revoke-identity.sh`, `revocation-drill.sh` | COMPLETE AND VERIFIED (disposable identity) | drill: certificate and whole identity refused, others unaffected | passed | revoke the superseded live certificate (B3) |
| Fabric backup and restore | `fabric/backup.sh`, `restore.sh` | COMPLETE AND VERIFIED | encrypted backup, restore, height check, new transactions | passed (run 3; runs 1 and 2 kept) | — |
| Database ahead of a restored ledger | `services/operations.ts` `checkpointBehindLedger` | COMPLETE AND VERIFIED | integrity test (local ledger); drill on Fabric | passed | — |
| PostgreSQL ↔ ledger consistency check | `services/consistency.ts`, `GET /api/admin/consistency` | COMPLETE AND VERIFIED | integrity tests; drill; local server check | passed | — |
| Chaincode queries (record by tx id, paged queries, verify) | `contract.ts` | COMPLETE AND VERIFIED | chaincode tests; Fabric IT | passed | — |
| Case A/B/C handling, operation log, event consumer, reconciler, idempotency | `services/operations.ts`, `sync` | COMPLETE AND VERIFIED | sync and failure tests; real outages (earlier evidence) | passed | — |
| Database constraints, indexes, append-only audit log | migration `004_integrity.sql` | COMPLETE AND VERIFIED | integrity tests; CI migrations job simulated locally | passed | CI on GitHub (B1) |
| Clean initialization, migrations twice, dump and restore | `src/cli/migrate.ts`, `db.ts` | COMPLETE AND VERIFIED | clean-init evidence | identical tables | — |
| Paged and filtered lists; shipment trace; audit paging | `services/lists.ts`; `/shipments`, `/ledger/records`, `/alerts`, `/admin/audit` | COMPLETE AND VERIFIED | integrity tests; OpenAPI route coverage | passed | — |
| Server-side sessions (sign-out, password change and reset end sessions) | `auth.ts`, migration 005, `/auth/logout`; `Store.tsx` | COMPLETE AND VERIFIED | sessions tests (8); live e2e (3 new) | passed | — |
| First administrator for a real installation | `services/bootstrap.ts`, `npm run bootstrap` | COMPLETE AND VERIFIED | bootstrap tests (4); PostgreSQL and container runs | passed | data import (B6) |
| Analytics served with provenance; damaged, outdated and missing files reported | `services/analytics.ts`, `analysis/scripts/write_manifest.py`, `check_manifest.py` | COMPLETE AND VERIFIED | analytics-files tests (7); manifest check | passed | — |
| Python analysis reproducible | `analysis/run_all.sh`, `compare_results.py` | COMPLETE AND VERIFIED | fresh environment; inputs match the dataset manifest | all outputs identical | — |
| OpenAPI document | `scripts/openapi.py` → `openapi.json` (0.4.0) | COMPLETE AND VERIFIED | route coverage test; regenerated with no diff | passed | — |
| API container | `wethaq-api/Dockerfile`, `docker-compose.yml` | COMPLETE AND VERIFIED | build (sandbox npm step), compose run, non-root | passed | — |
| Chaincode container | `chaincode/shipment/Dockerfile` | IMPLEMENTED BUT NOT VERIFIED on this branch | build blocked here (B11); the earlier image runs on the network | — | CI *docker* job (B1) |
| Single-server deployment configuration | `deploy/compose.yml`, `Caddyfile`, `production.env.example` | COMPLETE AND VERIFIED locally | full workflow through Caddy on Fabric; CSP browser check | passed | hosted deployment (B2) |
| Hosted deployment | — | BLOCKED | — | — | B2 |
| CI: validate, lint, API, migrations, chaincode, analysis, Docker, secrets, audit, browser, Fabric | `.github/workflows/*.yml`, `.github/scripts/pull-image.sh` | COMPLETE AND VERIFIED except `fabric.yml` | GitHub Actions on pull requests #13 to #15 | quality checks #27 and browser QA #23 passed (after two fixes); `fabric.yml` not run on GitHub | B1 |
| Lint | `eslint.config.js` | COMPLETE AND VERIFIED | `npx eslint .` | 0 errors, 106 warnings | warnings in existing code |
| Dependencies | three `package-lock.json` | COMPLETE AND VERIFIED | `npm audit` | 0 vulnerabilities | — |
| No secrets in the repository | `.gitignore`; CI *secrets* job | COMPLETE AND VERIFIED | the job's patterns on the tree and history | 0 findings | — |
| Security review | [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | COMPLETE AND VERIFIED (the team's own review) | code and configuration review; tests named there | — | independent review (B10) |
| Demo mode and visual design unchanged | dashboard | COMPLETE AND VERIFIED | demo e2e | 54 passed | — |
| Cancellation, returns, multi-step partial receipts | — | PARTIALLY COMPLETE | short receipt test (chaincode, API) | passed | B5 |
| Per-user Fabric identities | — | NOT APPLICABLE to this design (one identity per organization; F9) | — | — | — |
| User acceptance testing | — | BLOCKED | — | — | B9 |
| macOS and WSL2 | scripts and docs | IMPLEMENTED BUT NOT VERIFIED | Linux only on this branch | — | B12 |
| Documentation (completion, traceability, tests, security, deployment, backup, discrepancies, change log, blockers) | `docs/gp482/` | COMPLETE AND VERIFIED | written from the evidence files; links checked | — | — |
