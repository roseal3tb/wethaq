# Wethaq GP482: final completion report

Date: 2026-11-27, updated for the GP1 submission (branch `gp1-final-readiness`, merged as pull request #17 on
2026-11-28), with the first native arm64 run on 2026-11-28, and for the GP1 closure (branch `gp1-closure`,
2026-11-28). Sections 1 to 6 describe the GP482 work merged through pull requests #13 to #16; §0 describes the
readiness branch and §0a the closure. The GP481 report and the research results in `analysis/results/` were not
changed. The sign-off is in [GP1_FINAL_SIGNOFF.md](GP1_FINAL_SIGNOFF.md).

**Status.** The backend, the Hyperledger Fabric integration and the operations work are complete for a
single-machine academic prototype. Every suite was run on a freshly created Fabric 2.5.12 network and passed. The
system is **not complete in every respect**, and it is not production-ready or deployed. The GitHub Actions checks
pass on pull requests, and the manual Fabric workflow passed on GitHub on `main` on 2026-11-28 (7 of 7, NFR 31 of
31). Nothing has been hosted: **actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been
deployed to Oracle Cloud during GP1.** The Vercel site runs Demo Mode and is not connected to any blockchain
network. User testing was not carried out (materials are prepared). Cancellation and return workflows do not exist.
The open items are listed in [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md).

## 0a. GP1 closure (branch `gp1-closure`)

| Item | Change | Status | Evidence |
| --- | --- | --- | --- |
| Fresh `fabric.yml` run on GitHub (x64) | run 46169704428 on `main` | COMPLETE AND VERIFIED: 7 of 7, NFR 31 of 31 | [github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md) |
| Pull-request checks and Node 20 warnings | read on GitHub, not taken from a report | COMPLETE AND VERIFIED: all passed, no Node 20 deprecation annotation | same |
| Fabric installer | pinned commit, SHA-256 per archive, image digests; upstream helper no longer run | COMPLETE AND VERIFIED on x86_64; on GitHub not yet run | [fabric-install/](evidence/gp1-closure-2026-11-28/fabric-install/README.md) |
| Accidental network replacement | `up.sh` asks or needs `--recreate`; `down.sh` asks | COMPLETE AND VERIFIED | regression `persistence.txt`; DEPLOYMENT_GUIDE.md §4 |
| Accessibility | heading order fixed with no visual change; NFR2 table-alternative test | NFR2 criteria COMPLETE AND VERIFIED; contrast documented (B8) | [accessibility/](evidence/gp1-closure-2026-11-28/accessibility/README.md) |
| arm64 measurements | peaks by phase, storage, network start phases, optional 2 CPU / 12 GB limit | IMPLEMENTED BUT NOT VERIFIED (needs a run) | [arm64-measurement-context.md](evidence/gp1-closure-2026-11-28/arm64-measurement-context.md) |
| Academic requirements | FR1–FR12 and NFR1–NFR7 compared with the GP481 report; phase names questioned | COMPLETE (no university requirements document was available) | [academic-requirements-verification.md](evidence/gp1-closure-2026-11-28/academic-requirements-verification.md) |
| User and expert evaluation | kit prepared | prepared, **not executed** | [UAT_AND_EXPERT_EVALUATION_KIT.md](UAT_AND_EXPERT_EVALUATION_KIT.md) |
| Final regression | every suite, at `d0835da` | COMPLETE AND VERIFIED (API image build blocked in this sandbox only) | [regression/](evidence/gp1-closure-2026-11-28/regression/README.md) |

## 0. GP1 submission readiness (branch `gp1-final-readiness`)

| Item | Change | Status | Evidence |
| --- | --- | --- | --- |
| Manual Fabric workflow on GitHub | the artifact `wethaq-fabric-run.zip` was checked (checksum, contents, secret scan) and kept unchanged | Integration: COMPLETE AND VERIFIED (7 of 7) | [evidence/github-fabric-2026-11-27/](evidence/github-fabric-2026-11-27/README.md) |
| NFR failure hidden on GitHub | the GitHub NFR run was 30 of 31 (429 from the sign-in rate limit) but the step passed. `nfr.ts` now exits 1 when a check fails; `fabric.yml` and the arm64 workflow wait 65 s before the NFR step | COMPLETE AND VERIFIED: 31 of 31 locally, exit 1 seen on a failing run, and 31 of 31 on GitHub in the arm64 run of 2026-11-28 | [evidence/github-arm64-2026-11-28/](evidence/github-arm64-2026-11-28/README.md) |
| GitHub Actions Node 20 deprecation | `actions/checkout` v4.2.2 → v7.0.1, `actions/setup-node` v4 → v7.1.0, `actions/upload-artifact` v4.6.2 → v7.0.2, all pinned by full commit SHA and declaring `node24`. The application stays on Node 22 and the chaincode job on Node 20 | COMPLETE AND VERIFIED that they run (arm64 run, 2026-11-28); pull-request #17 checks reported passing by the owner | commit message lists the SHAs |
| Native arm64 readiness | manual workflow *Oracle Cloud ARM64 Readiness* (`ubuntu-24.04-arm`): arch checks, image manifests, native builds, Fabric, PostgreSQL, API, integration, NFR, browser test, resources, sanitized artifact | COMPLETE AND VERIFIED on a GitHub-hosted arm64 runner (run 46166121729, 2026-11-28); not a deployment | [evidence/github-arm64-2026-11-28/](evidence/github-arm64-2026-11-28/README.md) |
| arm64 static audit | every image publishes `linux/arm64`; Fabric arm64 binaries exist; no hard-coded amd64; no native npm builds | COMPLETE AND VERIFIED | [ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md) §4 |
| Oracle Cloud readiness | proposed Ampere A1 configuration checked against Oracle's Always Free documentation; GP2 deployment guide (25 steps, placeholders) | DEFERRED TO GP2 (deployment); documentation COMPLETE | [ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md) |
| Accessibility | automated axe check on 7 pages, both colour schemes; 4 kinds of finding fixed with pixel-identical screenshots; contrast and heading order documented | PARTIALLY COMPLETE (B8) | [evidence/gp1-final-2026-11-27/accessibility/](evidence/gp1-final-2026-11-27/accessibility/README.md) |
| Chaincode on Node 20 (end-of-life) | documented, not migrated | DEFERRED TO GP2 (B16) | ORACLE_CLOUD_READINESS.md §4.5 |
| Regression on the final code | every suite below, at commit `4e134e7` | COMPLETE AND VERIFIED | [evidence/gp1-final-2026-11-27/](evidence/gp1-final-2026-11-27/README.md) |

Final regression (2026-11-27, Linux x86-64): dashboard unit 20; chaincode 24; API 109 passed, 7 skipped;
Demo Mode browser 54 passed, 2 skipped; live-mode browser 9; Fabric network checks 14 of 14; Fabric integration 7;
Fabric browser 1; NFR 31 of 31; lint 0 errors (106 warnings); both builds and the CSP hash check pass. The first
Fabric attempt in that session failed because the ledger had already been seeded; after a fresh network everything
passed (details in the evidence README).

User acceptance testing and expert evaluation were not carried out; no participant feedback or evaluation
results exist, and none are reported.

## 1. What this branch added

| Area | Added | Verified by |
| --- | --- | --- |
| Fabric certificate revocation | `revoke-identity.sh` revokes a client identity or one superseded certificate and puts the CRL into the organization's channel MSP. It refuses admin, peer, orderer and registrar identities. `revocation-drill.sh` uses a disposable identity | drill on the real network |
| Fabric backup and restore | `backup.sh` (consistent, mode 600, optional AES-256 encryption) and `restore.sh` (Fabric resources only, with confirmation). `wait_for_orderer` in `start.sh` and `restore.sh` | drill: restore to the same height, then new transactions |
| Ledger older than the database | the API detects a checkpoint ahead of the ledger, moves it back, raises a Critical alert and audits it. A read-only consistency check compares every shipment and transaction id | integrity tests; drill on Fabric |
| Database integrity | migration 004: quantity and status CHECK constraints, indexes, an append-only trigger on `audit_log`. `$$`-aware SQL splitting | integrity tests; clean init; dump and restore identical |
| Lists for growing data | paged and filtered `/shipments`, `/ledger/records`, `/alerts`, `/admin/audit` (keyset cursor), shipment trace | integrity tests; OpenAPI 0.4.0 |
| Sessions | migration 005: server-side sign-out (`revoked_tokens`), session versions ended by a password change or reset; the dashboard signs out on the server | sessions tests; 3 new live browser tests |
| Analytics verification | `MANIFEST.json` of the result files, checked by the API (verified, modified, outdated, unverified) and in CI. Precomputed results are labelled as such. Missing or damaged files answer 503 with a reason | analytics-files tests; analysis reproduced byte for byte |
| First installation | `npm run bootstrap`: reference data and one administrator with a temporary password, without demonstration data | tests; PostgreSQL and container runs |
| Single-server deployment (prepared) | `deploy/compose.yml` (PostgreSQL, API in Fabric mode, Caddy with HTTPS and a CSP), `production.env.example` | full workflow through Caddy on Fabric, locally; CSP browser check with a negative control |
| CI | jobs for lint, migrations (twice, plus dump and restore), analysis manifest, Docker images (Docker Hub, then the public.ecr.aws mirror, bounded attempts, optional login), live browser tests, the CSP hash; extended secret scan | passed on GitHub (quality checks #27, browser QA #23) after two fixes, see FINAL_TEST_REPORT.md |
| Lint | ESLint over the whole repository with the existing config | 0 errors (106 warnings) |
| Documentation | the files in §5 | — |

The API grew from 71 to 109 tests, and the live browser suite from 6 to 9. No existing test was removed or
weakened. One NFR check changed because migration 004 now refuses the tampering it simulated (see FINAL_TEST_REPORT.md,
note 4).

## 2. Verification summary

| Component | Status |
| --- | --- |
| Fabric network, channel, chaincode lifecycle, endorsement by both organizations | COMPLETE AND VERIFIED |
| Identity enrollment, renewal | COMPLETE AND VERIFIED |
| Identity revocation | COMPLETE AND VERIFIED with a disposable identity. Revoking the superseded live certificate awaits approval (B3) |
| Fabric backup and restore; database ahead of a restored ledger; consistency check | COMPLETE AND VERIFIED |
| Chaincode rules and queries | COMPLETE AND VERIFIED |
| Gateway submission, Case A/B/C, reconciliation, event consumer, idempotency | COMPLETE AND VERIFIED |
| PostgreSQL schema, constraints, append-only audit, clean init, dump and restore | COMPLETE AND VERIFIED |
| Authentication, roles, server-side sessions, production configuration, bootstrap | COMPLETE AND VERIFIED |
| Analytics with provenance and file verification | COMPLETE AND VERIFIED |
| Dashboard live mode on Fabric; demo mode and design unchanged | COMPLETE AND VERIFIED |
| API container image | COMPLETE AND VERIFIED (built with a sandbox-only npm proxy step) |
| Chaincode container image on this branch | IMPLEMENTED BUT NOT VERIFIED (B11) |
| Single-server configuration | COMPLETE AND VERIFIED locally; not deployed |
| CI workflows | COMPLETE AND VERIFIED: `checks.yml` and `browser-qa.yml` on GitHub (pull request #15; #17 reported passing by the owner), the integration tests of `fabric.yml` (2026-11-27), and `oracle-arm64-readiness.yml` (2026-11-28, NFR 31 of 31) |
| Hosted deployment | DEFERRED TO GP2 (B2) |
| Cancellation, returns, multi-step partial receipts | PARTIALLY COMPLETE (B5) |
| User acceptance testing | BLOCKED (B9) |
| Per-user Fabric identities | NOT APPLICABLE to this design |

The requirement-by-requirement matrix is [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md). The
differences from the GP481 report are in [REPORT_DISCREPANCIES.md](REPORT_DISCREPANCIES.md).

## 3. Test results (final run)

| Suite | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| Dashboard unit | 20 | 0 | 0 |
| Chaincode unit | 24 | 0 | 0 |
| API | 109 | 0 | 7 (Fabric suite, run separately below) |
| Demo-mode browser, 4 viewports | 54 | 0 | 2 (mobile-only test on wider viewports) |
| Live-mode browser | 9 | 0 | 0 |
| Fabric network checks | 14 | 0 | — |
| Fabric integration | 7 | 0 (first attempt failed: API not started) | 0 |
| Fabric browser, full workflow | 1 | 0 | 0 |
| NFR on Fabric | 31 | 0 (first attempt failed: see FINAL_TEST_REPORT.md) | 0 |
| Type checks, build, lint (0 errors), OpenAPI up to date, analysis manifest, npm audit (0), secret scan (0) | pass | — | — |

Logs and exit codes: [evidence/completion-2026-11-27/final-run/](evidence/completion-2026-11-27/final-run/exit-codes.txt).
Details, skips and blocked items: [FINAL_TEST_REPORT.md](FINAL_TEST_REPORT.md).

## 4. Constraints kept

* The stack is unchanged: Hyperledger Fabric, PostgreSQL, Express, TypeScript, React and the Python pipeline. The only
  new dependencies are the pinned ESLint packages, installed in CI with `--no-save`.
* The dashboard's design and demo mode are unchanged. The dashboard changes were server sign-out in `live.ts` and
  `Store.tsx`, comments in empty `catch` blocks, and `let` → `const` in `mock.ts`, which changes no values.
* No forecasting method, dataset or result was changed. The original datasets were only read, from a separate
  folder, and their checksums match the dataset's manifest.
* No existing identity was revoked, no existing database was dropped, nothing was pushed or deployed, and no paid
  resource was created. The drills used disposable identities and scratch databases.
* `supabase/migrations`, generated files and published history were not touched.

## 5. Documents

| File | Contents |
| --- | --- |
| [FINAL_COMPLETION_REPORT.md](FINAL_COMPLETION_REPORT.md) | this report (was `FINAL_REPORT.md`) |
| [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) | requirement, location, status, verification, result and remaining work (was `STATUS_MATRIX.md`) |
| [FINAL_TEST_REPORT.md](FINAL_TEST_REPORT.md) | every suite, with failures, skips and blocked items (was `TEST_EVIDENCE.md`) |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | controls, findings and their status |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | deployment, configuration, the single-server setup, environments, rollback, troubleshooting (was `DEPLOYMENT.md`) |
| [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) | backups, restores, revocation, failure handling |
| [REPORT_DISCREPANCIES.md](REPORT_DISCREPANCIES.md) | GP481 report compared with the implementation |
| [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md) | what is not done and what unblocks it |
| [ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md) | arm64 audit, Oracle Always Free checks, GP2 deployment guide (no deployment in GP1) |
| [CHANGELOG.md](CHANGELOG.md) | changes by branch |
| [ARCHITECTURE.md](ARCHITECTURE.md), [DIAGRAMS.md](DIAGRAMS.md) | design and diagrams |
| `wethaq-api/openapi.json` | the API (OpenAPI 3.0, version 0.4.0, served at `/api/openapi.json`) |
| `.env.example`, `wethaq-api/.env.example`, `deploy/production.env.example` | every setting, without secrets |

Evidence files written before the renaming still refer to the old file names.

## 6. Earlier GP482 work (change sets `a53f392` and `gp482-gaps`)

### Before GP482

* The React + TypeScript + Vite dashboard with its visual design, in **demo mode** (synthetic data in the browser),
  deployed on Vercel, with 54 Playwright tests for the design and workflows.
* An Express + PostgreSQL API (`wethaq-api`) with JWT sign-in, four roles, user management, a **local development
  ledger** in PostgreSQL, and a first Fabric mode that signed with the samples' `User1` identity; 41 tests.
* The TypeScript shipment chaincode with the five rules (authorized organization, valid reference, valid quantity,
  valid transition, no duplicate receipt) and its unit tests.
* `fabric/install.sh`, `up.sh`, `down.sh` for the test network.
* The Python analysis (assessment, forecasting with Naive/MA12/SES/Croston/SBA/TSB and scikit-learn
  `HistGradientBoostingRegressor`, rolling origin, inventory simulation) and its result files.

#### What was missing

Fabric CA identities and an application identity per organization; scripts to start, stop, verify, upgrade and reset
the network safely; any handling of unknown transaction outcomes, so PostgreSQL could disagree with the ledger;
an event consumer for transactions from other clients; idempotency; live inventory from the database; analytics
APIs; audit logging; production configuration rules; health checks; OpenAPI; containers and CI for the API and
chaincode; failure and end-to-end tests on Fabric; deployment and operations documentation.

#### What was implemented

| Area | Implemented |
| --- | --- |
| Fabric network | Test network with Fabric CAs; channel `wethaq`; endorsement `AND(Org1MSP.peer, Org2MSP.peer)`; chaincode as a service; scripts `setup`, `up`, `start`, `stop`, `deploy-chaincode`, `upgrade-chaincode`, `enroll-identities`, `renew-identities`, `verify-network`, `query`, `reset` (asks for confirmation, touches only Fabric resources) |
| Identities | `wethaq-app` client identity per organization, enrolled from its CA, private keys git-ignored (mode 600); renewal script; revocation procedure |
| Chaincode | `ReadTransactionRecord`, `QueryTransactionRecords` (filters, pagination), `VerifyShipment`; rejected attempts recorded on the ledger; 24 tests |
| Synchronization | Operation log written before submission; Case A/B/C responses (200/201, 422, 202, 409, 502, 503); exactly-once projection of records, status, timeline, inventory and alerts; chaincode event consumer with a checkpoint (re-subscribes after a failure); reconciler using `qscc`; `Idempotency-Key` |
| Inventory | Positions computed from PostgreSQL with stock in transit; changed once per committed transaction; shortage, discrepancy, pending and sync alerts with de-duplication |
| Analytics | `/api/analytics` (files with SHA-256 provenance) and `/api/analytics/v1/*` (filtered datasets, methods, parts, forecasts, metrics, classification, model comparison, rolling origin, inventory simulation and policies) |
| Dashboard (live mode only) | API inventory and RAF results with loading and error states and no mock fallback; pending (202) state; ledger-state badges; verification messages; correct Fabric / local-ledger wording |
| Security | Production rules (strong secret, demo features off, single CORS origin), audit log, request ids, JSON logs with redaction, sign-in rate limit, MSP taken from the user's organization in the database |
| Reliability | 503 when PostgreSQL is unreachable and nothing submitted; the API survives PostgreSQL restarts; commits during a database outage are applied when it returns |
| Operations | Health endpoints, Dockerfile and compose profile, OpenAPI 3, CI (dashboard, API, chaincode, secret scan, npm audit; manual Fabric workflow), deployment guide, backup/restore, rollback, troubleshooting |
| Documentation | `ARCHITECTURE.md`, `DEPLOYMENT.md`, `DIAGRAMS.md` (10 diagrams), `STATUS_MATRIX.md`, `TEST_EVIDENCE.md` (since renamed, see §5), `CHANGELOG.md`, evidence files, this report |

#### What was modified

API modules (`app.ts`, `db.ts`, `config.ts`, ledger adapters, services), migration `003_ledger_sync.sql` (new tables
and columns; earlier migrations unchanged), the chaincode contract and rules, the Fabric scripts, and in the dashboard
only `src/api/live.ts`, `src/context/Store.tsx`, `src/types.ts`, `src/data/raf.ts`, the new `src/data/useRafData.ts`,
and the live-mode branches of the Forecasts, Overview, Inventory and Shipments pages. Dependencies: `vitest` 2 → 4.1.12
(all projects), `react-router-dom` 6 → 7.18.7, `@hyperledger/fabric-protos` added as a direct dependency.

#### What was preserved

The visual design, pages, navigation and demo mode (54 demo browser tests pass, unchanged); the GP481 report; the
analysis scripts and result files (served unchanged, with checksums); the role model (Planner, Dispatcher, Receiver,
Admin) and the organization model (Org1 issuing, Org2 receiving, orderer organization); Express, PostgreSQL, React,
Vite and Python. No Ethereum, Solidity, IoT or hardware components were added; XGBoost and SimPy were not used.
