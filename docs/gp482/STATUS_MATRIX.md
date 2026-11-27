# GP482 implementation status

Status as of 2026-11-27, branch `gp482-gaps` (based on `main` at dca1140). The final report is [FINAL_REPORT.md](FINAL_REPORT.md).
**Done** = implemented and covered by tests that were run (see [TEST_EVIDENCE.md](TEST_EVIDENCE.md)).
**Partial** = implemented, with the limits stated. **Not done** = deliberately out of scope or deferred.

| Area | Requirement | Status | Where | Evidence |
|---|---|---|---|---|
| Network | Fabric 2.5 test network, 2 peer orgs + orderer org | Done | `fabric/up.sh` | verify-network 13/13 |
| Network | Fabric CA, MSP, enrolled application identities | Done | `up.sh -ca`, `enroll-identities.sh` | `/health/ready` identities |
| Network | Identity renewal (re-enrollment, previous identity kept) | Done | `fabric/renew-identities.sh` | run for both orgs; API committed with the renewed identities |
| Network | Identity revocation (CRL in the channel MSP) | Not done | `DEPLOYMENT.md` §8 | documented procedure only |
| Network | Direct ledger reads with the peer CLI, independent of the API | Done | `fabric/query.sh` | used by the Fabric browser test |
| Network | Scripts: setup, start, stop, create channel, deploy, upgrade, enroll, verify, reset (with confirmation) | Done | `fabric/*.sh` | all run here; `reset.sh` cancels on any answer but `reset`, and left an unrelated container running |
| Network | Endorsement by both organizations | Done | `CC_POLICY` in `lib.sh` | committed definition |
| Chaincode | Register, Dispatch, MarkInTransit, Receive with the five rules | Done (GP481) | `chaincode/shipment` | 24 tests |
| Chaincode | ReadTransactionRecord, QueryTransactionRecords (paginated), VerifyShipment | Done | `contract.ts` | unit + Fabric tests |
| Chaincode | Rejected attempts recorded on the ledger | Done | `contract.ts` | Case B test on Fabric |
| API | Case A / B / C distinguished in responses (200/201, 422, 202 / 409 / 502 / 503) | Done | `services/operations.ts` | sync tests, real orderer and peer outages |
| Sync | Operation row written before submit, keyed by the Fabric txId | Done | `ledger_operations` | sync tests |
| Sync | Exactly-once projection (record, status, events, inventory, alerts) | Done | `applyRecord` | duplicate-apply test |
| Sync | Chaincode event consumer with checkpoint, other clients' transactions | Done | `startSync` | Fabric test 5 |
| Sync | Reconciler for unknown outcomes and crashes (qscc) | Done | `reconcile` | sync tests, real orderer outage |
| Sync | Idempotency-Key | Done | `executeOperation`, dashboard sends one per action | sync + Fabric tests |
| Inventory | Live inventory from PostgreSQL, applied once per transaction | Done | `services/inventory.ts`, `/api/inventory` | sync tests |
| Inventory | Live dashboard uses API inventory, no mock fallback | Done | `Inventory.tsx`, `Overview.tsx` | tsc, live e2e |
| Analytics | Results served with provenance (file, script, dataset, SHA-256) | Done | `services/analytics.ts` | sync tests |
| Analytics | Detailed analytics API with filters (datasets, methods, parts, per-part forecast, metrics, classification, model comparison, rolling origin, inventory simulation and policies, provenance) | Done | `/api/analytics/v1/*`, `services/analytics.ts` | 7 API tests; OpenAPI 0.3.0 |
| Analytics | Live Forecasts and Overview pages read the RAF results from the API, with a loading state and an error instead of the bundled copy | Done | `useRafData.ts`, `Forecasts.tsx`, `Overview.tsx` | live browser test checks the file name and SHA-256 shown |
| Verify | verified / mismatch / not_found / pending / ledger_unavailable / failed | Done | `verifyShipment` | sync + Fabric tests |
| Alerts | Dedupe; Pending transaction and Ledger sync alerts | Done | migration 003, `raiseAlert` | sync tests |
| Security | Demo routes off in production; strong secret; no DEMO_PASSWORD; strict CORS | Done | `config.ts`, `app.ts` | config tests |
| Security | Audit log, request ids, structured logs with redaction | Done | `audit.ts`, `logger.ts` | admin audit test |
| Security | Per-user Fabric identities | Not done | — | documented limitation (one app identity per org) |
| Frontend | Strict 422 handling, 202 pending state, ledger state badge, duplicate-submit guard | Done | `live.ts`, `Store.tsx`, `Shipments.tsx` | tsc, live e2e; demo e2e 54 passed |
| Frontend | Demo mode and visual design unchanged | Done | — | 54 demo browser tests |
| Frontend | Ledger tab wording in live mode (block, Fabric transaction id, local ledger not called Fabric) | Done | `Shipments.tsx` | live and Fabric browser tests; demo wording unchanged |
| Frontend | API on another origin (`VITE_API_URL`) | Done | `live.ts` | tsc; not deployed |
| End to end | Planner → forecasts → inventory → request → dispatch → in transit → receipt on Fabric, checked on the peer and in PostgreSQL, rejection, alerts, API restart | Done | `e2e-fabric/fabric.spec.ts` | 1 test, 17 steps, passed on Fabric 2.5.12 |
| Reliability | PostgreSQL unavailable: 503, nothing submitted to the ledger, API keeps running and recovers | Done | `db.ts`, `app.ts` | 6 failure tests; real outage on Fabric ([evidence](evidence/postgres-outage-fabric-2026-11-27.txt)) |
| Reliability | PostgreSQL lost after a ledger commit: 202, then applied once when it is back (event consumer re-subscribes from its checkpoint) | Done | `startSync` | failure tests |
| Reliability | API restart mid-operation; concurrent operations on one shipment; same Idempotency-Key at once | Done | — | failure tests; restart also in the Fabric browser test |
| Ops | PostgreSQL backup and restore, catch-up from the ledger after restore | Done | `DEPLOYMENT.md` §5 | executed on Fabric ([evidence](evidence/backup-restore-renewal-2026-11-27.md)) |
| Ops | Fabric volume backup and restore | Not done | `DEPLOYMENT.md` §5 | documented procedure only |
| Ops | Deployment, configuration, rollback, troubleshooting guide | Done | `DEPLOYMENT.md` | — |
| Security | Dependency vulnerabilities | Done | vitest 4.1.12, react-router-dom 7.18.7 | `npm audit`: 0 in all three projects ([evidence](evidence/npm-audit-2026-11-27.md)) |
| API docs | OpenAPI 3, served at `/api/openapi.json`, checked against the routes | Done | `wethaq-api/openapi.json` | route coverage test |
| Ops | Health live/ready | Done | `/api/health/live`, `/ready` | tests |
| Ops | API Dockerfile and compose profile | Partial | `wethaq-api/Dockerfile` | image build blocked by Docker Hub rate limit here; layout verified |
| CI | API, chaincode, secret scan, npm audit on pull requests; manual Fabric workflow | Partial | `.github/workflows` | valid YAML; not yet run on GitHub |
| Docs | Architecture, deployment, 10 Mermaid diagrams, status, evidence, change log, final report | Done | `docs/gp482/` | all diagrams parse with Mermaid 11 |
| Scope | Interviews and user testing | Not done | — | deferred by Sara |
| Scope | IoT, Ethereum/Solidity, XGBoost | Not done | — | excluded by the brief |
| Deploy | Hosting the API or Fabric publicly | Not done | — | needs explicit authorization; nothing deployed |
