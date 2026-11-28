# Wethaq GP482 — final test report

This file was called `TEST_EVIDENCE.md` until pull request #13; evidence files written before then still use the
old name.

## GP1 closure (2026-11-28, branch `gp1-closure`)

**Final regression, local.** At commit `d0835da` on Linux x86-64 (Node 22.23.5, npm 10.9.9, Docker 29.9.3,
PostgreSQL 16), 17:42 to 17:53 UTC. Every output is in
[evidence/gp1-closure-2026-11-28/regression/](evidence/gp1-closure-2026-11-28/regression/README.md).

| Suite | Result |
| --- | --- |
| Dashboard type check, build, unit tests | pass; 20 of 20 |
| ESLint | 0 errors, 106 warnings (reviewed, listed in the evidence README) |
| Chaincode unit tests | 24 of 24 |
| API type check and tests (local ledger) | pass; 109 passed, 7 skipped (the Fabric-only file) |
| `npm audit` (dashboard, API, chaincode, production dependencies) | 0 vulnerabilities each |
| Secret scan of tracked files | nothing found |
| Demo Mode browser tests | 58 passed, 2 skipped (the new NFR2 test added 4) |
| Live-mode browser tests | 9 of 9 on the re-run. The first run failed 6 tests because the regression script's Fabric variables (`DEMO_PASSWORD`, `LEDGER_MODE`) leaked into the tests' own API; nothing was changed between the runs |
| Pinned `fabric/install.sh` | pass, both archives SHA-256 verified |
| Fresh network (`up.sh --recreate`), migrations twice, seed | pass (network in 43 s) |
| Fabric integration tests | 7 of 7 |
| NFR on Fabric | 31 of 31 (slowest average write 540 ms, p95 reads 84 ms, 20 concurrent in 0.21 s) |
| NFR with a wrong password | exit 1, as it must |
| `stop.sh` then `start.sh` | ledger history and PostgreSQL counts identical; Fabric integration 7 of 7 afterwards |
| Fabric browser test | 1 of 1 |
| API production image build | fails in this sandbox only (npm inside Docker cannot reach the registry, B11); built on GitHub arm64 on 2026-11-28 |

**On GitHub.** `fabric.yml` run 46169704428 on `main` (3347560), 28 Nov 2026, x64: 7 of 7, NFR 31 of 31, Fabric
browser test passed, 4 m 42 s. The pull-request checks of #17 and #18 were read on GitHub and passed
([github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md)). `fabric.yml` and the arm64 workflow have
**not yet run on `gp1-closure`**.

**Also checked:** a clean install with the pinned installer and a wrong-hash test
([fabric-install/](evidence/gp1-closure-2026-11-28/fabric-install/README.md)); `up.sh` refusing to replace an
existing network; axe before and after the heading fix, and 30 screenshots compared
([accessibility/](evidence/gp1-closure-2026-11-28/accessibility/README.md)).

## GP1 submission update (2026-11-27, branch `gp1-final-readiness`)

**Final regression, local.** At commit `4e134e7` on Linux x86-64 (Node 22.23.5, Docker 29.9.3, PostgreSQL 16,
Fabric 2.5.12, CA 1.5.15), on a freshly created network:

| Suite | Result |
| --- | --- |
| Dashboard unit tests | 20 passed |
| ESLint | 0 errors, 106 warnings |
| Builds (Demo Mode and live mode), CSP hash | pass |
| Chaincode unit tests | 24 passed |
| API type check; API tests | pass; 109 passed, 7 skipped |
| Demo-mode browser tests, 4 viewports | 54 passed, 2 skipped |
| Live-mode browser tests | 9 passed |
| `verify-network.sh` | 14 of 14 |
| Fabric integration | 7 passed |
| NFR on Fabric (`sleep 65 && npm run nfr`) | 31 of 31, exit 0 |
| Fabric browser test | 1 passed |

Logs and reports: [evidence/gp1-final-2026-11-27/](evidence/gp1-final-2026-11-27/README.md). The first Fabric
attempt of that session failed (5 of 7 integration tests, 17 of 24 NFR checks) because the ledger had already been
seeded once, so the seed stopped with "Shipment SHP-2026-0005 already exists". A reseed needs a fresh network; after
`./fabric/up.sh` everything passed. That failing NFR run exited 1, which confirms the fix below.

**Manual Fabric workflow on GitHub (2026-11-27).** The project owner ran *Fabric integration (manual)* on
`ubuntu-latest` (x64): the run succeeded in 3 min 49 s with **7 of 7** Fabric integration tests passing. Its
artifact is kept unchanged in [evidence/github-fabric-2026-11-27/](evidence/github-fabric-2026-11-27/README.md).
The NFR report in that artifact shows **30 of 31**: the *SQL injection in the sign-in form* check expected 400 or 401
and got 429, because the integration suite had just used up the sign-in rate limit (10 per minute). The NFR script
exited 0 anyway, so the step and the run showed success. Fixed on this branch: `nfr.ts` sets exit code 1 when any
check fails, and `fabric.yml` waits 65 s before the NFR step. The run URL and commit were not recorded. Until the
workflow runs again on GitHub, the NFR result on GitHub stays 30 of 31.

**Accessibility (automated only).** axe-core 4.14.1 on 7 pages in both colour schemes:
[evidence/gp1-final-2026-11-27/accessibility/](evidence/gp1-final-2026-11-27/accessibility/README.md). This does not
establish WCAG conformance.

**Native arm64 on GitHub (2026-11-28).** *Oracle Cloud ARM64 Readiness*, run
<https://github.com/roseal3tb/wethaq/actions/runs/46166121729> on `main` (`c9c445b`), Arm Neoverse-N2, 4 vCPU,
16 GB, no emulation. Every step passed: native image builds, Fabric network (every container `linux/arm64`),
Fabric integration tests, **NFR 31 of 31** (the first GitHub NFR run after the fix), the Fabric browser test in
Chromium arm64, and the production API image. Evidence:
[evidence/github-arm64-2026-11-28/](evidence/github-arm64-2026-11-28/README.md). This is a test on a GitHub-hosted
runner, not a deployment.

**Not run in GP1:** any cloud deployment (deferred to GP2), user acceptance testing and expert evaluation (no
results exist). A second x64 run of `fabric.yml` after the fix was not supplied.

## Earlier GP482 run

Every number on this page was copied from the output of a run on 2026-11-27 (UTC) on the development machine
(Linux x64, Ubuntu 24.04 container, Node 22.23.5, Docker 29.9, PostgreSQL 16.15, Hyperledger Fabric 2.5.12, Fabric CA
1.5.15). The final run started at commit `5f1ff0d` on branch `gp482-final`
([commit.txt](evidence/completion-2026-11-27/final-run/commit.txt)). The NFR run that passed used the one-line
change to the NFR script described in note ⁴, committed afterwards as `301863e`. Every suite's log and exit code is in
[evidence/completion-2026-11-27/final-run/](evidence/completion-2026-11-27/final-run/exit-codes.txt). Before the
run the Fabric network was recreated (`./fabric/reset.sh --yes`, `./fabric/up.sh`) and the database seeded on it.

**GitHub Actions (2026-11-27, three pull requests).** Both workflows that run on pull requests pass on GitHub since
pull request #15: *Wethaq quality checks* run #27 and *Responsive browser QA* run #23 both passed. Getting there took
two fixes, and both earlier failures are kept here:
1. Pull request #13: browser QA passed. In the quality checks, the *Database · migrations* job failed at the dump and
   restore. The runner's `pg_dump` is newer than the PostgreSQL 16 service, and `pg_restore` into 16 refused
   `SET transaction_timeout`. Fix: dump and restore with the tools inside the PostgreSQL 16 container.
2. Pull request #14: the database job passed. The *Docker* job failed because public.ecr.aws answered
   **429 Too Many Requests** to anonymous pulls of the Node.js base image. Fix: pull each base image from Docker Hub
   first, then from the mirror, with bounded attempts (`.github/scripts/pull-image.sh`).
3. Pull request #15: everything passed.

At the time of this run the manual *Fabric integration* workflow (`fabric.yml`) had not been run on GitHub; it was run on 2026-11-27 afterwards (see the GP1 update above).

Everything else on this page ran locally.

## Final run (branch `gp482-final`)

| Suite | Command | Ledger | Passed | Failed | Skipped | Baseline (b92b950) |
|---|---|---|---|---|---|---|
| Dashboard type check | `npm run check` | — | exit 0 | | | exit 0 |
| Dashboard unit tests | `npm test` | — | **20** | 0 | 0 | 20 |
| Dashboard build | `npm run build` | — | exit 0 | | | exit 0 |
| ESLint, whole repository | `npx eslint .` | — | 0 errors | | 106 warnings ¹ | not run |
| Chaincode unit tests | `cd chaincode/shipment && npm test` | in-memory stub | **24** | 0 | 0 | 24 |
| API type check | `cd wethaq-api && npm run check` | — | exit 0 | | | exit 0 |
| API tests | `cd wethaq-api && npx vitest run` | local ledger + PGlite | **109** | 0 | 7 ² | 71 passed, 7 skipped |
| OpenAPI document up to date | `python3 scripts/openapi.py && git diff --exit-code openapi.json` | — | exit 0 | | | — |
| Analysis results match MANIFEST.json | `analysis/scripts/check_manifest.py` | — | 5 files ok | | | — |
| Demo-mode browser tests, 4 viewports | `npx playwright test` | none (demo) | **54** | 0 | 2 ³ | 54 passed, 2 skipped |
| Live-mode browser tests | `npm run test:live` | local ledger | **9** | 0 | 0 | 6 |
| Fabric network checks | `./fabric/verify-network.sh` | Fabric | **14 ok** | 0 | | 14 |
| Fabric browser test, full workflow | `npx playwright test -c playwright.fabric.config.ts` | **Fabric** | **1** | 0 | 0 | 1 |
| Fabric integration | `FABRIC_IT=1 npx vitest run test/fabric.integration.test.ts` | **Fabric** | **7** | 0 ⁴ | 0 | 7 |
| NFR measurements | `npm run nfr` | **Fabric** | **31 of 31** | 0 ⁴ | 0 | 31 of 31 |
| Dependency audit (3 projects) | `npm audit` and `npm audit --omit=dev` | — | 0 vulnerabilities | | | 0 |
| Secret scan (the CI job's patterns) | tracked tree and `b92b950..HEAD` history | — | 0 findings | | | — |

The NFR report of this run: [nfr-report.md](evidence/completion-2026-11-27/final-run/nfr-report.md).

¹ Warnings only: mostly `@typescript-eslint/no-explicit-any` and `react-hooks/exhaustive-deps` in existing code.
`no-explicit-any` was lowered from an error to a warning in `eslint.config.js` rather than fixed, so that the
dashboard's code is not reworked; Prettier formatting is not enforced (`prettier/prettier` off). The ESLint packages are not in `package.json`. They were installed here, at the
versions listed under *Re-running*, with `npm install --no-save`.

² The 7 skipped tests are the Fabric integration suite, which only runs with `FABRIC_IT=1` against a running network.
It is the *Fabric integration* line.

³ The mobile-navigation test runs only on viewports up to 760 px, so it is skipped on the tablet and desktop ones.

⁴ Two suites failed on their **first attempt** in this run. Both are kept with their logs:
* Fabric integration (`fabric-integration-attempt1-api-not-started.log`): the suite needs a running API, and it was
  started after the API had been stopped for the Fabric browser test (`ECONNREFUSED 127.0.0.1:4000`). It passed once
  the API was started, with no change.
* NFR (`nfr-attempt1.log`): the check *A change made directly in PostgreSQL is detected* simulates tampering by raising
  `received_qty` by 5. Migration 004's new constraint `shipments_received_le_dispatched` now refuses that, so the
  script stopped. The tampering was changed to lowering the value by one and restoring it (commit `301863e`). The
  check still requires the verification to report the mismatch and to match again after the restore. In the same
  attempt the SQL-injection sign-in check got **429** instead of 401, because the sign-in rate limit (10 per minute)
  had been used by the integration suite a few seconds earlier. It passed when run again after a minute, with no
  change to the limit or the check.

The test counts grew because of new tests, and no existing test was removed or weakened:
* API: +38 (integrity 19, analytics result files 7, sessions 8, bootstrap 4).
* Live browser: +3 (server sign-out, expired session, API unreachable).

## Other checks executed on this branch

| Check | Result | Evidence |
|---|---|---|
| Fabric identity revocation, disposable identity (certificate and whole identity) | refused after revocation; others unaffected | [revocation-drill.txt](evidence/completion-2026-11-27/revocation-drill.txt) |
| Fabric encrypted backup and restore, then the API on the restored ledger | height restored; checkpoint reset detected; consistency check found exactly the shipment created after the backup | [fabric-backup-restore.txt](evidence/completion-2026-11-27/fabric-backup-restore.txt) (runs 1 and 2 failed: drill-script bug, orderer not ready; kept) |
| PostgreSQL clean initialization and isolated dump and restore | migrations idempotent; every table identical | [postgres-init-backup-restore.txt](evidence/completion-2026-11-27/postgres-init-backup-restore.txt) |
| Python analysis reproduced in a fresh environment | inputs match the dataset manifest; every output identical | [python-reproduction.txt](evidence/completion-2026-11-27/python-reproduction.txt) |
| API image build and compose run (production, local ledger) | built; healthy; non-root; migrations applied | [docker-build-compose.txt](evidence/completion-2026-11-27/docker-build-compose.txt) |
| Single-server configuration (`deploy/`), locally | full workflow through Caddy on Fabric | [single-vm-deploy-check.txt](evidence/completion-2026-11-27/single-vm-deploy-check.txt) |
| First-administrator bootstrap on PostgreSQL | as designed; refuses a used database | [bootstrap-cli.txt](evidence/completion-2026-11-27/bootstrap-cli.txt) |
| Content-Security-Policy in a browser, with a negative control | 0 violations; control detected 10 | [csp-check.txt](evidence/completion-2026-11-27/csp-check.txt) |

## Not run, or blocked

| What | Why |
|---|---|
| The manual `fabric.yml` on GitHub | not run at the time of this run; run on 2026-11-27 afterwards (GP1 update above) |
| Chaincode image build (`docker build chaincode/shipment`) | npm cannot reach the registry from build containers in this sandbox (`Exit handler never called`). The network used the image built earlier; the chaincode source is unchanged since b92b950. The API image was built with a sandbox-only proxy step that is not committed |
| Mermaid diagrams | not re-parsed in this run. No diagram was changed on this branch, only links |
| Hosted deployment | not done; deferred to GP2 (ORACLE_CLOUD_READINESS.md) |
| macOS and WSL2 | this branch ran only on Linux (DEPLOYMENT_GUIDE.md §10) |
| Load beyond the NFR script's 20 concurrent requests, long-running stability, user acceptance testing | out of scope here; user testing was deferred by the project owner |

## Re-running on your machine

```bash
./fabric/up.sh                                   # Fabric CA, identities, chaincode
cd wethaq-api && npm install
npm run migrate && npm run seed -- --reset       # LEDGER_MODE=fabric in .env
npm run dev                                      # terminal 1
npm test                                         # terminal 2: API suite
npm run test:fabric                              # Fabric integration (DEMO_PASSWORD from .env)
sleep 60 && npm run nfr                          # NFR (wait a minute after the line above: sign-in rate limit)
# stop the API in terminal 1 (Ctrl+C), then from the repository root:
npx playwright install chromium                  # once
npx playwright test -c playwright.fabric.config.ts   # browser test on Fabric (starts the API itself)
npx playwright test && npm run test:live         # demo and live browser tests (nothing on port 4000)
npm install --no-save eslint@9.39.5 @eslint/js@9.39.5 typescript-eslint@8.74.0 eslint-plugin-react-hooks@5.2.0 \
  eslint-plugin-react-refresh@0.4.26 globals@16.5.0 eslint-plugin-prettier@5.5.7 eslint-config-prettier@10.1.9 prettier@3.10.1
npx eslint .
```

## Earlier final run (branch `gp482-gaps`, commit b92b950)

Kept for comparison; these are the §16 baseline numbers.

| Suite | Command | Ledger | Result |
|---|---|---|---|
| Chaincode unit tests | `cd chaincode/shipment && npm test` | in-memory stub | **24 passed** |
| API tests | `cd wethaq-api && npm test` | local development ledger + PGlite | **71 passed**, 7 skipped (the Fabric suite, which needs `FABRIC_IT=1`) |
| Fabric integration | `cd wethaq-api && npm run test:fabric` | **Hyperledger Fabric 2.5.12** | **7 passed** |
| NFR measurements | `cd wethaq-api && npm run nfr` | **Hyperledger Fabric 2.5.12** | **31 of 31 passed** ([report](evidence/final-run-2026-11-27/nfr-report.md)) |
| Fabric network checks | `./fabric/verify-network.sh` | Fabric | **14 of 14 ok** |
| Fabric browser test, 17 steps | `npx playwright test -c playwright.fabric.config.ts` | **Hyperledger Fabric 2.5.12** | **1 passed** ([steps](evidence/final-run-2026-11-27/ui-fabric-steps.txt)) |
| Dashboard unit tests | `npm test` | — | **20 passed** |
| Dashboard type check / build | `npm run check` · `npm run build` | — | pass / pass |
| Demo-mode browser tests (design unchanged) | `npx playwright test` | none (demo mode) | **54 passed**, 2 skipped (mobile-only test on wider viewports) |
| Live-mode browser tests | `npx playwright test -c playwright.live.config.ts` | local development ledger | **6 passed** |
| Dependency audit | `npm audit` in the three projects | — | **0 vulnerabilities** each ([review](evidence/npm-audit-2026-11-27.md)) |

## Fabric browser test (`e2e-fabric/fabric.spec.ts`)

One Playwright test drives the dashboard in live mode against the API in Fabric mode, and checks every result
independently: on the peer with the peer CLI (`fabric/query.sh`, not the API) and in PostgreSQL with direct queries.
The test starts the API itself so that it can restart it.

1. The planner signs in. 2. The Forecasts page shows the RAF results from the API with the file's SHA-256.
3. Inventory is shown. 4. The planner requests 4 units. 5. The peer has the shipment and one `request` record.
6. PostgreSQL has the same transaction id, `ledger_state = confirmed` and a block number. 7–9. Dispatcher dispatches
and marks in transit; the receiver confirms 3 units (toasts say "committed on Fabric · block N").
10. The peer's history has request, dispatch, transit and receive, each with a 64-hex transaction id that
`ReadTransactionRecord` finds; PostgreSQL has exactly those ids; shipment state matches. 11. Origin stock −4,
destination +3. 12. The Ledger tab lists the three movement transactions with their Fabric ids and blocks.
13. Verify → "matches the ledger". 14. A second receipt is rejected by the chaincode (422, `source: chaincode`) and a
dispatch by the receiver by the application (422, `source: application`); nothing changes on the peer or in
PostgreSQL. 15. A *Receipt quantity mismatch* and a *Rejected attempt* alert exist. 16. The receiver acknowledges the
mismatch alert (stored in PostgreSQL). 17. The API is stopped and started again: the Ledger tab, the shipment state,
verification and the acknowledged alert are all unchanged.

## Failure tests (`wethaq-api/test/failures.test.ts`, local development ledger)

* PostgreSQL unreachable → `/health/ready` 503, liveness 200, requests 503 with "The database is not reachable",
  sign-in 503; the ledger received nothing (same number of blocks and submissions); ready again when it returns.
* PostgreSQL lost right after the ledger committed → 202 pending; the ledger has the dispatch and PostgreSQL does not;
  when PostgreSQL returns, the event consumer re-subscribes from its checkpoint and applies it **once** (one record,
  one timeline entry, stock moved once). Without the re-subscription the test fails (checked by disabling it).
* API restart mid-operation: the old process's event consumer is stopped and its request never answers; a new API
  process on the same database applies the committed dispatch from the checkpoint; verify → verified.
* Two simultaneous dispatches of one shipment → one 200 and one 409/422; one committed record; stock moved once.
* Two simultaneous receipts → one committed, the other rejected; stock moved once.
* The same Idempotency-Key sent twice at once → one shipment, one operation row.

On the real network PostgreSQL was also stopped under a running API ([output](evidence/postgres-outage-fabric-2026-11-27.txt)):
before the fix the API process exited on the pg pool's unhandled `error` event; after it, `/health/live` 200,
`/health/ready` 503, a request 503, and after PostgreSQL started again a request committed in the next block (43).

## Backup, restore and identity renewal on the real network

See [evidence/backup-restore-renewal-2026-11-27.md](evidence/backup-restore-renewal-2026-11-27.md): both identities
renewed (new serials and keys), a PostgreSQL dump restored into a new database, and a dispatch committed after the
backup (block 44) applied to the restored copy when an API started on it.

## Earlier runs (change set `a53f392`)

An earlier NFR run in the same session reported 30 of 31: the sign-in rate limit (10 per minute) answered 429 to the
SQL-injection probe because the Fabric integration tests had signed in four times in the same minute. Run again a
minute later: 31 of 31. The limit is working as designed; the two suites should not be run within the same minute.

## Fabric network (real)

`WETHAQ_SKIP_CC_BUILD=1 ./fabric/up.sh` (the chaincode image was built from `chaincode/shipment` beforehand, because
this container cannot download npm packages inside `docker build`):

* Network started with **Fabric CA** for Org1, Org2 and the orderer org (`network.sh up createChannel -ca -c wethaq`).
* Chaincode `wethaq` 1.0, sequence 1, approvals `Org1MSP: true, Org2MSP: true`, policy `AND('Org1MSP.peer','Org2MSP.peer')`.
* `enroll-identities.sh` registered and enrolled `wethaq-app` with each CA: subject `OU=client, CN=wethaq-app`,
  valid until 2027-11-27. `/api/health/ready` reports both identities with 364 days left.
* Seeding through Fabric: 48 shipments, **125 ledger transactions** (120 workflow + 5 rejected demonstrations) in 7.0 s.

### Stop, start and upgrade

* `./fabric/stop.sh` then `./fabric/start.sh`: ledger kept, verify-network all ok.
* `WETHAQ_SKIP_CC_BUILD=1 ./fabric/upgrade-chaincode.sh`: definition moved to **version 1.2, sequence 2**, approved by
  both organizations, verify-network all ok, existing ledger kept.
* The API was left running through all three. The Fabric integration suite was then run again: **7 passed**, including
  the event-stream test, so the event consumer had reconnected by itself.

### Reset

* Answering `no` to `./fabric/reset.sh`: "Cancelled.", exit 1, all 8 network containers still running.
* With an unrelated `busybox` container running, answering `reset`: the Fabric containers, ledger volumes and
  `fabric/identities/` were removed; the unrelated container was still running afterwards.

## Case C on the real network

| Test | What was done | Observed |
|---|---|---|
| Orderer down (unknown outcome) | `docker stop orderer.example.com`, then `POST /api/shipments` | **HTTP 202** `pending: true` in 52 ms; Gateway `SubmitError` (`14 UNAVAILABLE: no orderers could successfully process transaction`); shipment kept with `ledger_state = pending`; verify → `pending`; one *Pending transaction* alert |
| Recovery | `docker start orderer.example.com`; reconciler every 10 s | `qscc` reported the transaction id as not found; still pending until `PENDING_EXPIRY_MS`; after **310 s** marked `failed / expired`; shipment `ledger_state = failed`; verify → `failed`; pending alert closed, one *Ledger sync* alert raised |
| Peer down (definite) | `docker stop peer0.org2.example.com`, then dispatch | **HTTP 502** `ledgerFailure: endorsement`; shipment status unchanged (`Requested`) |
| Peer back | `docker start peer0.org2.example.com`, same dispatch | **HTTP 200**, committed in block 127 |

## Fabric integration suite (`test/fabric.integration.test.ts`)

1. Readiness reports Fabric, with CA-enrolled `wethaq-app` identities for Org1MSP and Org2MSP.
2. A request commits (Case A): 64-hex txId, block > 0; `qscc` says `VALID` in the same block; verify on the peer → `verified`.
3. A dispatch above the requested quantity is rejected by the chaincode (Case B) and `ReadTransactionRecord` returns the rejected record.
4. The same `Idempotency-Key` twice returns the same txId, and the ledger history has exactly one committed dispatch.
5. A transaction submitted by **another Fabric client** (a second gateway connection, not the API) is applied to
   PostgreSQL by the event consumer: status `In Transit`, one reporting record attributed to `Org1 (Issuing) (ledger client)`, checkpoint advanced.
6. A random transaction id is `not_found` in `qscc`.
7. The shipment's history contains request, dispatch and transit records.

## API suite highlights (`test/sync.test.ts`, local development ledger with injected faults)

* Unavailable network → 503, no shipment row left, operation `failed`, audit entry.
* Endorsement failure → 502, no state change.
* Commit-status timeout after a real commit → 202 (or 200 if the event arrived first); the result is applied **once**:
  one DISPATCH record, one timeline entry, stock decreased once, pending alert closed.
* Lost submission → 202, request `pending`, operations on it refused (409), then `failed` after the expiry, with a *Ledger sync* alert.
* Crash after commit and before the PostgreSQL update → the reconciler applies it.
* Ledger unreachable during reconciliation → nothing decided, exactly one open sync alert, verify → `ledger_unavailable`; closed when reachable again.
* Same `Idempotency-Key` → same shipment, one operation row; malformed key → 400.
* The same ledger record applied three times → one record, one event, one stock change.
* One open shortage alert per part and location.
* Admin-only sync status, reconcile and audit; liveness, readiness, request ids.
* Live inventory (180 positions, with stock in transit) and analytics with SHA-256 provenance.
* Production configuration: demo features forced off, weak `JWT_SECRET`, `DEMO_PASSWORD` and `CORS_ORIGIN=*` refused; demo endpoints answer 403 when disabled.
* The OpenAPI document lists every route the app registers.
