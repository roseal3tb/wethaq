# Wethaq on Hyperledger Fabric

The planned design of Section 4.3.6: the standard Fabric **test network**, with two peer organizations
(Org1 = issuing, Org2 = receiving, one peer each) and a separate ordering organization.
The shipment chaincode (`../chaincode/shipment`) applies the five transaction rules, and its endorsement
policy `AND('Org1MSP.peer','Org2MSP.peer')` means every transaction needs both organizations.

## First time

Docker Desktop must be running.

```bash
./fabric/install.sh          # downloads Fabric 2.5 samples, tools and images (a few minutes)
```

## First time (and whenever you want a new, empty ledger)

```bash
./fabric/up.sh               # network + channel "wethaq" + chaincode (about 2–4 minutes)
cd wethaq-api
# in .env: LEDGER_MODE=fabric
npm run seed -- --reset      # reload PostgreSQL and replay the demo history onto the new ledger
npm run dev
```

`./fabric/up.sh` always starts a fresh ledger, so run `npm run seed -- --reset` after it to keep
PostgreSQL and the ledger in step. It is not a restart command: when a network already exists it stops, asks you to
type `recreate`, and changes nothing if you do not (or if it is not run in a terminal). `./fabric/up.sh --recreate`
replaces an existing network without asking.

## Every other time

```bash
./fabric/start.sh            # starts the stopped network with its ledger, then runs verify-network.sh
./fabric/stop.sh             # stops it and keeps the ledger
```

| Script | What it does |
|---|---|
| `install.sh [samples] [binary] [docker]` | One-time download of fabric-samples (pinned commit), the Fabric 2.5.12 and CA 1.5.15 binaries (SHA-256 checked) and images (pulled by digest). See *Supply chain* below |
| `up.sh [--recreate]` | Fresh network with Fabric CAs, channel, chaincode, application identities, then `verify-network.sh`. Refuses to replace an existing network unless confirmed |
| `stop.sh` / `start.sh` | Stop / start the containers and keep the ledger (no re-seed needed) |
| `verify-network.sh` | Checks containers, channel membership, the committed definition and both approvals, a chaincode query and certificate expiry |
| `deploy-chaincode.sh [version] [sequence]` | Builds the chaincode image and deploys it (used by `up.sh`) |
| `upgrade-chaincode.sh [version]` | Deploys changed chaincode as the next sequence, keeping the ledger |
| `enroll-identities.sh` | Registers and enrolls the API's `wethaq-app` identity with each organization's CA (used by `up.sh`) |
| `renew-identities.sh [1|2]` | Re-enrolls `wethaq-app` with its CA (new certificate and key); keeps the previous identity next to it. Restart the API afterwards |
| `query.sh tx <txId>` · `history <shipmentId>` · `shipment <shipmentId>` | Reads the ledger directly from a peer with the peer CLI (no API, no PostgreSQL) |
| `reset.sh` | Deletes the network, its ledger and the identities. Asks you to type `reset` (`--yes` skips the question); `down.sh` is the same script |

`reset.sh` (and `up.sh`, which starts from a clean network) removes the Wethaq chaincode containers and runs the
samples' `network.sh down`, which also removes containers labelled `service=hyperledger-fabric`, `dev-peer*` containers
and images, and stops containers whose name contains `ccaas`. Nothing else in Docker is touched.

Set `WETHAQ_SKIP_CC_BUILD=1` to reuse an existing `wethaq_ccaas_image` instead of building it.

`up.sh` also sets the orderer's `BatchTimeout` to 500 ms (the sample network waits 2 s), so a single transaction
commits in about half a second. A block still closes early when 10 transactions are waiting.

## How the chaincode runs

`up.sh` deploys the chaincode as a service (`network.sh deployCCAAS`): `docker build` makes an image from
`chaincode/shipment/Dockerfile`, and one chaincode container per peer (`peer0org1_wethaq_ccaas`,
`peer0org2_wethaq_ccaas`) serves the contract. The peers do not build chaincode images themselves, which
avoids the "docker build failed … broken pipe" error of Docker Desktop on macOS. The lifecycle (install,
approval by both organizations, commit with the endorsement policy) is the same as for a normal deployment.

## What the API does with Fabric

* The network's identities come from **Fabric CA** (`network.sh up -ca`), one CA per organization.
* The API connects through the Fabric Gateway SDK with its own **client** identity, `wethaq-app`, which
  `enroll-identities.sh` registers with each organization's CA and enrolls into `fabric/identities/org{1,2}/wethaq-app/msp`
  (git-ignored, readable only by you). It is one identity per organization, not per dashboard user: the ledger shows the
  organization, and the API's audit log shows the user. `/api/health/ready` lists both certificates and their expiry.
* A dispatch or in-transit update is submitted as Org1, a receipt as Org2, following the signed-in user's organization.
  Planner requests are registered on the ledger through Org1.
* The chaincode stores one state entry per shipment and one record per operation, including rejected attempts.
  Only the fields of Table 4.8 go on the ledger.
* `GET /api/shipments/:id/verify` runs `VerifyShipment` on the peer to compare the PostgreSQL copy with the world state.
* It follows the chaincode events (`ShipmentRegistered`, `ShipmentUpdated`, `OperationRejected`) from a stored checkpoint,
  applies each committed transaction to PostgreSQL once (including transactions from other clients), and forwards them to
  open dashboards through `GET /api/events`.
* A submission whose outcome is unknown (for example the orderer is down) answers HTTP 202 and is reconciled later with
  `qscc`; see `../docs/gp482/ARCHITECTURE.md`.

Settings (in `wethaq-api/.env`, all optional): `FABRIC_TEST_NETWORK` (default `../fabric/fabric-samples/test-network`),
`FABRIC_CHANNEL` (default `wethaq`), `FABRIC_CHAINCODE` (default `wethaq`), `FABRIC_ORG1_ENDPOINT` (`localhost:7051`),
`FABRIC_ORG2_ENDPOINT` (`localhost:9051`), `FABRIC_IDENTITY_DIR` (`../fabric/identities`), `FABRIC_APP_USER` (`wethaq-app`),
`FABRIC_EVALUATE_TIMEOUT_MS`, `FABRIC_ENDORSE_TIMEOUT_MS`, `FABRIC_SUBMIT_TIMEOUT_MS`, `FABRIC_COMMIT_TIMEOUT_MS`.

## Supply chain (install.sh)

`install.sh` no longer downloads and runs the upstream helper `install-fabric.sh` from the `main` branch of
hyperledger/fabric (a mutable source that is newer than the pinned versions). It now:

* clones hyperledger/fabric-samples and checks out commit `5789681b4f4d24e58fa40f19a69f5496892374b6` (an existing
  checkout at another commit is left as it is, with a warning, because a running network keeps files there);
* downloads the Fabric 2.5.12 and Fabric CA 1.5.15 archives for the detected platform (linux or darwin, amd64 or
  arm64) from the official GitHub releases and refuses to unpack them unless their SHA-256 matches the value in the
  script; it then checks that `peer` and `fabric-ca-client` report the expected versions;
* pulls peer, orderer, ccenv, baseos, tools and ca by digest, from ghcr.io/hyperledger first and Docker Hub second,
  and tags them `2.5.12`/`1.5.15`, `2.5`/`1.5` and `latest` as the test network expects.

Limitation: Hyperledger does not publish checksum or signature files for these archives, so the recorded hashes are
trust-on-first-use. They were taken from the official downloads on 2026-11-28, and the extracted `peer` and
`fabric-ca-client` binaries are byte-identical to the ones this project was tested with since September 2026.

