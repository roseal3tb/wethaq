# Change log — GP482 completion (branch `gp482-completion`)

## Fabric network
* `up.sh` now starts the network with Fabric CA (`-ca`), enrolls the application identities and runs `verify-network.sh`.
* New scripts: `lib.sh` (shared settings), `setup.sh`, `deploy-chaincode.sh`, `upgrade-chaincode.sh`,
  `enroll-identities.sh`, `verify-network.sh`, `start.sh`, `stop.sh`, `reset.sh` (asks for confirmation); `down.sh` calls `reset.sh --yes`.
* Chaincode containers restart automatically (`--restart unless-stopped`). Channel name configurable with `FABRIC_CHANNEL`.
* `fabric/identities/` (private keys) is git-ignored.

## Chaincode
* New: `ReadTransactionRecord`, `QueryTransactionRecords` (filters and pagination), `VerifyShipment`; a transaction index.
* Shipment ids are validated (`[A-Za-z0-9-]{1,64}`). Verification messages use field labels.
* 14 new unit tests (24 in total).

## API
* The API signs with the CA-enrolled `wethaq-app` identity of each organization instead of the samples' `User1`.
* New synchronization layer (`services/operations.ts`): durable operation log, Case A/B/C responses, exactly-once
  projection, chaincode event consumer with a checkpoint, reconciler using `qscc`, `Idempotency-Key`.
* Migration `003_ledger_sync.sql`: `ledger_operations`, `event_checkpoints`, `audit_log`; `shipments.ledger_state`,
  `shipments.last_tx_id`; alert types *Ledger sync* and *Pending transaction*; `alerts.dedupe_key`.
* `/api/inventory` returns computed positions with stock in transit; `/api/state` includes them.
* New routes: `/api/health/live`, `/api/health/ready`, `/api/openapi.json`, `/api/analytics`, `/api/analytics/:name`,
  `/api/admin/sync-status`, `/api/admin/reconcile`, `/api/admin/audit`.
* Verify returns a `status` (verified, mismatch, not_found, pending, ledger_unavailable, failed) and runs on the peer in Fabric mode.
* Production configuration rules; audit log; request ids; JSON logs with redaction.
* Fabric timeouts are configurable (`FABRIC_*_TIMEOUT_MS`); an unset value keeps the default.
* `@hyperledger/fabric-protos` is now a direct dependency (it was used through the gateway package).
* Dockerfile and an optional `api` profile in `docker-compose.yml`.
* Tests: 58 (was 41) plus a 7-test Fabric integration suite (`npm run test:fabric`).

## Dashboard (live mode only; demo mode unchanged)
* Inventory and Overview use the API's inventory positions.
* Pending (HTTP 202) results are shown as "waiting for the ledger"; shipments show a ledger-state badge when not confirmed.
* A 422 is treated as a rejection only when the body is a rejection result.
* Each request and ledger operation carries a new `Idempotency-Key`.
* Verification messages for every status; alert filters include the two new alert types.
* The RAF forecasting page shows whether its data matches the API's copy of `analysis/results/raf-forecasts.json`.

## CI
* `checks.yml`: API typecheck and tests, chaincode build and tests, a secret scan.
* `fabric.yml` (manual): full Fabric run on the runner (network, seed, integration tests, NFR).
