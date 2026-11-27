# Wethaq GP482 — final engineering report

Date: 2026-11-27. Scope: the backend, Hyperledger Fabric, integration, testing and operations work of GP482, delivered
in two change sets: `a53f392` (merged to `main` as `dca1140`) and branch `gp482-gaps`. The GP481 report and the
research findings in `analysis/results/` were not changed.

**Status in one paragraph.** The complete workflow (sign-in, forecasts, inventory, request, dispatch, in transit,
receipt, verification, rejection, alerts, restart) was run end to end through the dashboard on a real Hyperledger
Fabric 2.5.12 test network, and every result was checked on the peer and in PostgreSQL. It runs on one machine with
the fabric-samples test network. It is an academic prototype: it is not production-ready, not security-certified,
and nothing has been deployed to a hosted server.

## 1. Implementation summary

### What existed before GP482

* The React + TypeScript + Vite dashboard with its visual design, in **demo mode** (synthetic data in the browser),
  deployed on Vercel, with 54 Playwright tests for the design and workflows.
* An Express + PostgreSQL API (`wethaq-api`) with JWT sign-in, four roles, user management, a **local development
  ledger** in PostgreSQL, and a first Fabric mode that signed with the samples' `User1` identity; 41 tests.
* The TypeScript shipment chaincode with the five rules (authorized organization, valid reference, valid quantity,
  valid transition, no duplicate receipt) and its unit tests.
* `fabric/install.sh`, `up.sh`, `down.sh` for the test network.
* The Python analysis (assessment, forecasting with Naive/MA12/SES/Croston/SBA/TSB and scikit-learn
  `HistGradientBoostingRegressor`, rolling origin, inventory simulation) and its result files.

### What was missing

Fabric CA identities and an application identity per organization; scripts to start, stop, verify, upgrade and reset
the network safely; any handling of unknown transaction outcomes, so PostgreSQL could disagree with the ledger;
an event consumer for transactions from other clients; idempotency; live inventory from the database; analytics
APIs; audit logging; production configuration rules; health checks; OpenAPI; containers and CI for the API and
chaincode; failure and end-to-end tests on Fabric; deployment and operations documentation.

### What was implemented

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
| Documentation | `ARCHITECTURE.md`, `DEPLOYMENT.md`, `DIAGRAMS.md` (10 diagrams), `STATUS_MATRIX.md`, `TEST_EVIDENCE.md`, `CHANGELOG.md`, evidence files, this report |

### What was modified

API modules (`app.ts`, `db.ts`, `config.ts`, ledger adapters, services), migration `003_ledger_sync.sql` (new tables
and columns; earlier migrations unchanged), the chaincode contract and rules, the Fabric scripts, and in the dashboard
only `src/api/live.ts`, `src/context/Store.tsx`, `src/types.ts`, `src/data/raf.ts`, the new `src/data/useRafData.ts`,
and the live-mode branches of the Forecasts, Overview, Inventory and Shipments pages. Dependencies: `vitest` 2 → 4.1.12
(all projects), `react-router-dom` 6 → 7.18.7, `@hyperledger/fabric-protos` added as a direct dependency.

### What was preserved

The visual design, pages, navigation and demo mode (54 demo browser tests pass, unchanged); the GP481 report; the
analysis scripts and result files (served unchanged, with checksums); the role model (Planner, Dispatcher, Receiver,
Admin) and the organization model (Org1 issuing, Org2 receiving, orderer organization); Express, PostgreSQL, React,
Vite and Python. No Ethereum, Solidity, IoT or hardware components were added; XGBoost and SimPy were not used.

## 2. Verification summary

| Component | Status |
| --- | --- |
| Fabric network, channel, chaincode lifecycle, endorsement policy | Implemented and successfully tested (real network) |
| Fabric CA enrollment of application identities | Implemented and successfully tested |
| Identity renewal | Implemented and successfully tested |
| Identity revocation | Not implemented, with justification: requires a channel configuration update; procedure documented |
| Chaincode rules and new queries | Implemented and successfully tested (unit and on Fabric) |
| Fabric Gateway submission, commit status, authentic transaction ids and block numbers | Implemented and successfully tested (checked with `qscc` and the peer CLI) |
| Case A / B / C handling and reconciliation | Implemented and successfully tested (fault injection, and real orderer and peer outages) |
| Event consumer, transactions from other clients | Implemented and successfully tested |
| PostgreSQL projection, inventory applied once | Implemented and successfully tested |
| Idempotency and concurrent operations | Implemented and successfully tested |
| PostgreSQL outage and API restart | Implemented and successfully tested (tests, and a real outage on Fabric) |
| Analytics APIs with provenance and filters | Implemented and successfully tested |
| Dashboard live mode on Fabric | Implemented and successfully tested (17-step browser test) |
| Demo mode and design unchanged | Implemented and successfully tested |
| Authentication, roles, audit, production configuration | Implemented and successfully tested |
| OpenAPI document | Implemented and successfully tested (route coverage test) |
| PostgreSQL backup and restore with catch-up from the ledger | Implemented and successfully tested |
| Fabric ledger volume backup and restore | Implemented but not executed (procedure documented) |
| API container image | Partially implemented: Dockerfile written and its file layout verified; the image build was blocked by a Docker Hub rate limit here |
| CI workflows | Implemented but not executed (valid YAML; they run when a pull request is opened on GitHub) |
| Hosted deployment of the API and Fabric | Blocked by an external dependency: needs a hosting account and the owner's decision |
| Per-user Fabric identities | Not implemented, with justification: one service identity per organization; users are recorded in the ledger record and audit log |
| User interviews and usability testing | Not implemented, with justification: deferred by the project owner |

## 3. Test evidence

Final run on 2026-11-27, one step after another, in the development container (Linux x64, Node 22.23.5, Docker 27,
PostgreSQL 16, Fabric 2.5.12, Fabric CA 1.5.15). Every command, its exit code and its log:
[evidence/final-run-2026-11-27/SUMMARY.md](evidence/final-run-2026-11-27/SUMMARY.md).

| Command | Exit | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- |
| `npm run check` (dashboard) | 0 | — | — | — |
| `npm test` (dashboard) | 0 | 20 | 0 | 0 |
| `npm run build` (dashboard) | 0 | — | — | — |
| `npm run check` (API) | 0 | — | — | — |
| `npm test` (API) | 0 | 71 | 0 | 7 ¹ |
| `npm test` (chaincode) | 0 | 24 | 0 | 0 |
| `npm audit` (3 projects) | 0 | 0 vulnerabilities | | |
| `npx playwright test` (demo mode, 4 viewports) | 0 | 54 | 0 | 2 ² |
| `npx playwright test -c playwright.live.config.ts` | 0 | 6 | 0 | 0 |
| `./fabric/verify-network.sh` | 0 | 14 checks | 0 | — |
| `npx playwright test -c playwright.fabric.config.ts` (17 steps) | 0 | 1 | 0 | 0 |
| `npm run nfr` (API on Fabric) | 0 | 31 checks | 0 | 0 |
| `npm run test:fabric` (API on Fabric) | 0 | 7 | 0 | 0 |

¹ The Fabric integration suite inside the API project runs only with `FABRIC_IT=1`; it is the `test:fabric` line.
² The mobile-navigation test runs only on viewports up to 760 px, so it is skipped on the tablet and desktop ones.

Other executed checks, with their output in `evidence/`: the PostgreSQL outage under a running API on Fabric
(the API process used to exit; fixed and re-run), identity renewal, backup/restore with catch-up, network
stop/start/upgrade/reset, orderer and peer outages, and the npm audit review. Earlier, the first change set was
also run on the project owner's Mac (API 58 passed / 7 skipped, Fabric integration 7 passed, NFR 31 of 31,
`verify-network.sh` all ok).

Sanitized log excerpt (API on Fabric during the PostgreSQL outage):

```
{"level":"warn","event":"database_connection_lost","error":"error: terminating connection due to administrator command"}
ready: HTTP 503
create request: {"error":"The database is not reachable; try again shortly."} HTTP 503
--- PostgreSQL started
ready: HTTP 200
create request: {"id":"SHP-2026-0053", … "block":43,"ledgerState":"confirmed"} HTTP 201
```

## 4. Remaining requirements

| Kind | Requirement |
| --- | --- |
| External credentials | None needed for the local system. A hosted deployment would need a hosting account, a domain and TLS certificate, and a production `JWT_SECRET` kept outside the repository. |
| Missing datasets | None. The RAF data is public and the synthetic panel is generated; no proprietary aviation data was used, so results do not represent a real operator. |
| Hosting resources | A machine (or VMs) able to run Docker for Fabric and PostgreSQL, and a host for the API with HTTPS. Not provisioned; it may cost money and needs the owner's decision. |
| Manual infrastructure steps | Docker Desktop running; `./fabric/install.sh` once; `./fabric/up.sh`; `npm run migrate && npm run seed -- --reset`; renew identities yearly (`renew-identities.sh`); back up PostgreSQL. |
| Academic approvals | User interviews and usability testing (deferred) may need the department's approval and participant consent. |
| Security limitations | One Fabric identity per organization, not per user; JWT in browser session storage; no multi-factor sign-in; certificate revocation not exercised; demo accounts and role switching must stay off outside demonstrations (enforced with `NODE_ENV=production`); no independent security review or penetration test. |
| Deployment limitations | Single-host test network: one peer per organization and one orderer, so no fault tolerance; Fabric volume backup not exercised; the API container image not built here; CI workflows not yet run on GitHub; the Vercel site remains the demo and has no API. |

The system is demonstrable end to end on the local Fabric test network, as verified above. It should not be
described as production-ready or as a deployed service.
