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

## Every time

```bash
./fabric/up.sh               # network + channel "wethaq" + chaincode (about 2–4 minutes)
cd wethaq-api
# in .env: LEDGER_MODE=fabric
npm run seed -- --reset      # reload PostgreSQL and replay the demo history onto the new ledger
npm run dev
```

`./fabric/up.sh` always starts a fresh ledger, so run `npm run seed -- --reset` after it to keep
PostgreSQL and the ledger in step.

| Script | What it does |
|---|---|
| `up.sh` | Fresh network with Fabric CAs, channel, chaincode, application identities, then `verify-network.sh` |
| `stop.sh` / `start.sh` | Stop / start the containers and keep the ledger (no re-seed needed) |
| `verify-network.sh` | Checks containers, channel membership, the committed definition and both approvals, a chaincode query and certificate expiry |
| `deploy-chaincode.sh [version] [sequence]` | Builds the chaincode image and deploys it (used by `up.sh`) |
| `upgrade-chaincode.sh [version]` | Deploys changed chaincode as the next sequence, keeping the ledger |
| `enroll-identities.sh` | Registers and enrolls the API's `wethaq-app` identity with each organization's CA (used by `up.sh`) |
| `renew-identities.sh [1|2]` | Re-enrolls `wethaq-app` with its CA (new certificate and key); keeps the previous identity next to it. Restart the API afterwards |
| `query.sh tx <txId>` · `history <shipmentId>` · `shipment <shipmentId>` | Reads the ledger directly from a peer with the peer CLI (no API, no PostgreSQL) |
| `reset.sh` | Deletes the network, its ledger and the identities. Asks you to type `reset`; `down.sh` is the same without asking |

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
