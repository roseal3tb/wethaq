# Change log — first native arm64 run (branch `gp1-arm64-evidence`)

* `evidence/github-arm64-2026-11-28/`: the artifact of the first *Oracle Cloud ARM64 Readiness* run (every step
  passed, NFR 31 of 31). Native arm64, B14 and the NFR fix (B1, F15) are now COMPLETE AND VERIFIED; status updated in
  the completion and test reports, blockers, traceability, readiness, deployment guide and discrepancies.

# Change log — GP1 submission readiness (branch `gp1-final-readiness`, from `main` at `17e9113`)

## Evidence
* `evidence/github-fabric-2026-11-27/`: the artifact of the manual Fabric workflow run on GitHub (unchanged), with
  its checksum and what it shows (7 of 7 integration tests; NFR 30 of 31).
* `evidence/gp1-final-2026-11-27/`: final regression on the last code commit, NFR report, network check, and the
  automated accessibility check.

## Fixes
* `wethaq-api/src/cli/nfr.ts`: exits 1 when any check fails (it exited 0, which hid a failure on GitHub).
* `.github/workflows/fabric.yml`: waits 65 s for the sign-in rate-limit window before the NFR step.
* Accessibility, no visual change: main landmark on the sign-in and 404 pages; level-one heading on the
  *Access restricted* and *Page not found* states; labelled donut-chart sectors; *Guided demo* button name.

## CI
* `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2 (Node 24), pinned by
  commit SHA in every workflow.
* PostgreSQL in the *migrations* job and in `fabric.yml` is no longer a service container fixed to
  public.ecr.aws (the first run of this branch failed there with "Data limit exceeded"). A step starts it with
  `pull-image.sh`: Docker Hub, then public.ecr.aws, then mirror.gcr.io. Every base-image pull also falls back to
  mirror.gcr.io, and "Data limit exceeded" counts as a rate limit.
* New manual workflow `oracle-arm64-readiness.yml` (*Oracle Cloud ARM64 Readiness*, `ubuntu-24.04-arm`) and
  `.github/scripts/timed.sh`.

## Documentation
* New `ORACLE_CLOUD_READINESS.md`: arm64 audit, Oracle Always Free checks, GP2 deployment guide. No deployment.
* Updated: README, FINAL_COMPLETION_REPORT, FINAL_TEST_REPORT (formerly `TEST_EVIDENCE.md`), REMAINING_BLOCKERS
  (B1, B2, B4, B8; new B14 to B16), REQUIREMENTS_TRACEABILITY (new label DEFERRED TO GP2), SECURITY_AUDIT (F13
  fixed; F15 to F17), DEPLOYMENT_GUIDE, REPORT_DISCREPANCIES, ARCHITECTURE.
* OpenAPI: unchanged (no API route changed).

# Change log — final completion (branch `gp482-final`, from `b92b950`)

## Fabric
* `revoke-identity.sh`: revokes a client identity, or one superseded certificate, and writes the CRL into the
  organization's MSP definition on the channel. Refuses admin, peer, orderer and registrar identities. Has `--dry-run`
  and asks for confirmation. `revocation-drill.sh` runs a drill with a disposable identity.
* `backup.sh` and `restore.sh`: consistent backup of the whole test network (mode 600, optional encryption), and a
  restore that touches only Fabric resources.
* `lib.sh` `wait_for_orderer`, used by `start.sh` and `restore.sh`. The chaincode and its deploy script accept a
  base image (`NODE_IMAGE`, `WETHAQ_NODE_IMAGE`). `fabric/backups/` is git-ignored.

## API
* Migration 004: CHECK constraints on quantities and statuses, indexes, and an append-only trigger on `audit_log`.
  The SQL splitter keeps `$$` bodies whole.
* Migration 005 and `POST /auth/logout`: server-side sign-out. A password change or reset ends the user's other
  sessions.
* `GET /shipments`, `/shipments/:id` (trace), `/ledger/records`, `/alerts`: paged and filtered. `/admin/audit` now
  has filters and a cursor.
* `GET /admin/consistency`: read-only comparison of PostgreSQL with the ledger. On start, the API detects a
  checkpoint that is ahead of a restored ledger: it raises an alert, writes an audit row and resets the checkpoint.
  `Ledger.height()` was added for this.
* Analytics: result files are checked against `MANIFEST.json` (verified, modified, outdated, unverified). Missing,
  damaged or invalid files answer 503 with a reason. The provenance says the results are precomputed.
* `npm run bootstrap`: the first administrator of a real installation. The seed's reference data is shared through
  `insertReferenceData`.
* NFR script: the simulated tampering now stays within migration 004's constraints.
* OpenAPI 0.4.0; `.env.example` lists every setting.

## Analysis
* `write_manifest.py`, `check_manifest.py`, `compare_results.py`; `run_all.sh` writes the manifest (step 8).
  The results themselves are unchanged.

## Dashboard (live mode only; demo mode and design unchanged)
* Sign-out also ends the session on the server. Comments in empty `catch` blocks; `let` → `const` in `mock.ts`.
* Three new live-mode browser tests: server sign-out, an ended session, the API unreachable.

## Deployment
* `deploy/compose.yml`, `Caddyfile` (HTTPS, security headers, CSP) and `production.env.example` for one server,
  checked locally; `deploy/check-csp-hash.mjs`; `e2e-deploy/` CSP browser check. The root `.env.example` covers the
  dashboard settings. `.env` files, `deploy/production.env` and `dist-live/` are git-ignored.

## CI
* `checks.yml` rewritten:
  * jobs for lint, migrations (applied twice, seed, constraints, dump and restore), analysis manifest, Docker images
    (official base images from Docker Hub, then the public.ecr.aws mirror, bounded attempts, optional Docker Hub login) and secrets with more patterns;
  * the CSP hash step and the OpenAPI freshness check.
* `browser-qa.yml` gains a live-mode job. `fabric.yml` uses the mirror images.
* None of these has run on GitHub yet.

## Docs
* Renamed:
  * `FINAL_REPORT.md` → `FINAL_COMPLETION_REPORT.md`;
  * `STATUS_MATRIX.md` → `REQUIREMENTS_TRACEABILITY.md`;
  * `TEST_EVIDENCE.md` → `FINAL_TEST_REPORT.md`;
  * `DEPLOYMENT.md` → `DEPLOYMENT_GUIDE.md`.
* New: `SECURITY_AUDIT.md`, `BACKUP_AND_RECOVERY.md`, `REPORT_DISCREPANCIES.md`, `REMAINING_BLOCKERS.md`.
* Evidence is in `evidence/completion-2026-11-27/`. Older evidence files keep the old file names.

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

# Change log — remaining gaps (branch `gp482-gaps`, from `main` at dca1140)

## Analytics
* `/api/analytics/v1/*`: datasets (real RAF and synthetic kept apart), methods and their settings, parts with class
  and text filters, per-part forecast by method and horizon (1–6), metrics by dataset/split/method, classification,
  model comparison, rolling-origin results, inventory simulation and policies, provenance. Bad filters answer 400.
* `wethaq-api/scripts/openapi.py` generates `openapi.json` (now 0.3.0) including these routes.
* Live mode: the Forecasts and Overview pages load the RAF results from the API (`src/data/useRafData.ts`) with a
  loading state and an error message; the bundled copy is used only in demo mode.

## Reliability
* PostgreSQL unreachable → HTTP 503 with a clear message (`isDatabaseUnavailable` in `db.ts`); nothing is sent to
  the ledger. The pg pool now listens for connection errors: before, PostgreSQL stopping under a running API ended
  the API process.
* A transaction committed on the ledger while PostgreSQL went away answers 202 (pending) instead of 500.
* The ledger event consumer re-subscribes from its stored checkpoint when an event cannot be applied (default after
  5 s), so the checkpoint never moves past an unapplied transaction.

## Fabric scripts
* `fabric/renew-identities.sh`: re-enrolls the application identities, keeps the previous ones for rollback.
* `fabric/query.sh`: reads a transaction record, a shipment's history or its state straight from a peer.

## Dashboard (live mode only)
* Ledger tab: the block column says BLOCK (not DEMO BLOCK), the hash column has a live tooltip, and the note under
  the table describes Fabric or the local development ledger correctly. Demo wording unchanged.
* `VITE_API_URL` (optional) for an API on another origin.

## Dependencies
* `vitest` ^2.1.8 → ^4.1.12 in all three projects; `react-router-dom` ^6.30.1 → ^7.18.7. `npm audit`: 0 vulnerabilities.

## Tests
* `test/failures.test.ts` (6): PostgreSQL down, PostgreSQL lost after commit, API restart mid-operation, two
  concurrent dispatches, two concurrent receipts, the same Idempotency-Key at once.
* `test/analytics.test.ts` (7): the v1 analytics routes and their validation.
* `e2e-fabric/fabric.spec.ts` + `playwright.fabric.config.ts`: the 17-step workflow on real Fabric.
* A live browser test for the Forecasts page reading from the API.

## CI
* `checks.yml`: `audit` job for the three projects. `fabric.yml`: runs the Fabric browser test too.

## Docs
* `DEPLOYMENT.md` (deployment, configuration, start/stop, backup/restore, rollback, troubleshooting, certificates),
  `DIAGRAMS.md` (5 new diagrams; index of all 10), `FINAL_REPORT.md`, evidence files for the PostgreSQL outage,
  backup/restore/renewal and npm audit. A sequence diagram in `ARCHITECTURE.md` that did not parse was fixed.
