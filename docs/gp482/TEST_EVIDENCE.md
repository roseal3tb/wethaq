# GP482 test evidence

Everything on this page was run on 2026-11-27 (UTC) in the development container used to build this work
(Linux x64, Node 22.23, Docker 27, PostgreSQL 16). Numbers are copied from the actual output. The final run of every
suite, with its commands, exit codes and logs, is in [evidence/final-run-2026-11-27/](evidence/final-run-2026-11-27/SUMMARY.md).
The earlier change set (`a53f392`) was also run on Sara's Mac: API 58 passed / 7 skipped, Fabric integration 7 passed,
NFR 31 of 31, `verify-network.sh` all ok.

## Summary (final run, branch `gp482-gaps`)

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

## Not run here

* Fabric ledger volume backup/restore and certificate revocation: documented in DEPLOYMENT.md, not executed.

* `docker build -f wethaq-api/Dockerfile .`: Docker Hub answered **429 Too Many Requests** for `node:22-bookworm-slim`.
  The image's file layout was checked instead by copying exactly the files the Dockerfile copies into an empty folder
  and starting the API from there with `NODE_ENV=production` (migrations applied, `/api/health/ready` 200).
* The GitHub Actions workflows were checked as valid YAML but have not run on GitHub yet.
* No load test beyond the NFR script's 20 concurrent requests.

## Re-running on your machine

```bash
./fabric/up.sh                                   # now with Fabric CA and identities
cd wethaq-api && npm install
npm run migrate && npm run seed -- --reset       # LEDGER_MODE=fabric in .env
npm run dev                                      # terminal 1
npm test                                         # terminal 2: API suite
npm run test:fabric                              # Fabric integration (DEMO_PASSWORD from .env)
sleep 60 && npm run nfr                          # NFR (wait a minute after the line above: sign-in rate limit)
# stop the API in terminal 1 (Ctrl+C), then from the repository root:
npx playwright install chromium                  # once
npx playwright test -c playwright.fabric.config.ts   # 17-step browser test on Fabric (starts the API itself)
```
