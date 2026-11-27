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
PostgreSQL and the ledger in step. Stop everything with `./fabric/down.sh`.

`up.sh` also sets the orderer's `BatchTimeout` to 500 ms (the sample network waits 2 s), so a single transaction
commits in about half a second. A block still closes early when 10 transactions are waiting.

## How the chaincode runs

`up.sh` deploys the chaincode as a service (`network.sh deployCCAAS`): `docker build` makes an image from
`chaincode/shipment/Dockerfile`, and one chaincode container per peer (`peer0org1_wethaq_ccaas`,
`peer0org2_wethaq_ccaas`) serves the contract. The peers do not build chaincode images themselves, which
avoids the "docker build failed … broken pipe" error of Docker Desktop on macOS. The lifecycle (install,
approval by both organizations, commit with the endorsement policy) is the same as for a normal deployment.

## What the API does with Fabric

* It connects through the Fabric Gateway SDK with the test network's `User1` identity of each organization
  (`organizations/peerOrganizations/org{1,2}.example.com/users/User1@…`).
* A dispatch or in-transit update is submitted as Org1, a receipt as Org2, following the signed-in user's organization.
  Planner requests are registered on the ledger through Org1.
* The chaincode stores one state entry per shipment and one record per operation, including rejected attempts.
  Only the fields of Table 4.8 go on the ledger.
* `GET /api/shipments/:id/verify` reads the shipment and its history from the ledger and compares it with PostgreSQL.
* It listens to the chaincode events (`ShipmentRegistered`, `ShipmentUpdated`, `OperationRejected`) of every new block
  and forwards them to open dashboards through `GET /api/events`.

Settings (in `wethaq-api/.env`, all optional): `FABRIC_TEST_NETWORK` (default `../fabric/fabric-samples/test-network`),
`FABRIC_CHANNEL` (default `wethaq`), `FABRIC_CHAINCODE` (default `wethaq`), `FABRIC_ORG1_ENDPOINT` (`localhost:7051`),
`FABRIC_ORG2_ENDPOINT` (`localhost:9051`).
