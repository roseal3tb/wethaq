# GP482 test evidence

Everything on this page was run on 2026-11-27 (UTC) in the development container used to build this work
(Linux x64, Node 22.23, Docker 27, PostgreSQL 16). Numbers are copied from the actual output. Nothing has been
run on Sara's Mac yet for this change set: the commands to do so are at the end.

## Summary

| Suite | Command | Ledger | Result |
|---|---|---|---|
| Chaincode unit tests | `cd chaincode/shipment && npx vitest run` | in-memory stub | **24 passed** |
| API tests | `cd wethaq-api && npx vitest run` | local development ledger + PGlite | **58 passed**, 7 skipped (the Fabric suite, which needs `FABRIC_IT=1`) |
| Fabric integration | `cd wethaq-api && FABRIC_IT=1 npx vitest run test/fabric.integration.test.ts` | **Hyperledger Fabric 2.5.12** | **7 passed** |
| NFR measurements | `cd wethaq-api && npm run nfr` | **Hyperledger Fabric 2.5.12** | **31 of 31 passed** ([report](evidence/nfr-fabric-2026-11-27.md)) |
| Fabric network checks | `./fabric/verify-network.sh` (run by `up.sh`) | Fabric | **13 of 13 ok** ([output](evidence/verify-network-2026-11-27.txt)) |
| Dashboard unit tests | `npx vitest run` | — | **20 passed** |
| Dashboard type check / build | `npx tsc --noEmit -p .` · `npx vite build` | — | pass / pass |
| Demo-mode browser tests (design unchanged) | `npx playwright test` | none (demo mode) | **54 passed**, 2 skipped |
| Live-mode browser tests | `npx playwright test -c playwright.live.config.ts` | local development ledger | **5 passed** |

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
```
