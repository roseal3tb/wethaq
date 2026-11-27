# GP482 implementation status

Status as of 2026-11-27, branch `gp482-completion` (based on `main` at 8b38fc4).
**Done** = implemented and covered by tests that were run (see [TEST_EVIDENCE.md](TEST_EVIDENCE.md)).
**Partial** = implemented, with the limits stated. **Not done** = deliberately out of scope or deferred.

| Area | Requirement | Status | Where | Evidence |
|---|---|---|---|---|
| Network | Fabric 2.5 test network, 2 peer orgs + orderer org | Done | `fabric/up.sh` | verify-network 13/13 |
| Network | Fabric CA, MSP, enrolled application identities | Done | `up.sh -ca`, `enroll-identities.sh` | `/health/ready` identities |
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
| Analytics | Live Forecasts page checks the bundled RAF results against the API copy | Done | `Forecasts.tsx` | tsc (no dedicated browser test) |
| Verify | verified / mismatch / not_found / pending / ledger_unavailable / failed | Done | `verifyShipment` | sync + Fabric tests |
| Alerts | Dedupe; Pending transaction and Ledger sync alerts | Done | migration 003, `raiseAlert` | sync tests |
| Security | Demo routes off in production; strong secret; no DEMO_PASSWORD; strict CORS | Done | `config.ts`, `app.ts` | config tests |
| Security | Audit log, request ids, structured logs with redaction | Done | `audit.ts`, `logger.ts` | admin audit test |
| Security | Per-user Fabric identities | Not done | — | documented limitation (one app identity per org) |
| Frontend | Strict 422 handling, 202 pending state, ledger state badge, duplicate-submit guard | Done | `live.ts`, `Store.tsx`, `Shipments.tsx` | tsc, live e2e; demo e2e 54 passed |
| Frontend | Demo mode and visual design unchanged | Done | — | 54 demo browser tests |
| API docs | OpenAPI 3, served at `/api/openapi.json`, checked against the routes | Done | `wethaq-api/openapi.json` | route coverage test |
| Ops | Health live/ready | Done | `/api/health/live`, `/ready` | tests |
| Ops | API Dockerfile and compose profile | Partial | `wethaq-api/Dockerfile` | image build blocked by Docker Hub rate limit here; layout verified |
| CI | API, chaincode, secret scan on pull requests; manual Fabric workflow | Partial | `.github/workflows` | valid YAML; not yet run on GitHub |
| Docs | Architecture with Mermaid, status, evidence, change log, limitations | Done | `docs/gp482/` | — |
| Scope | Interviews and user testing | Not done | — | deferred by Sara |
| Scope | IoT, Ethereum/Solidity, XGBoost | Not done | — | excluded by the brief |
| Deploy | Hosting the API or Fabric publicly | Not done | — | needs explicit authorization; nothing deployed |
