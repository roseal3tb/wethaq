#!/usr/bin/env bash
# Starts the Fabric test network (Org1 = issuing, Org2 = receiving, one orderer), creates the
# "wethaq" channel and deploys the shipment chaincode as a service with an endorsement policy that needs both
# organizations. Any previous network and its ledger are removed first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="$ROOT/fabric/fabric-samples/test-network"
if [ ! -d "$NET" ]; then echo "Run ./fabric/install.sh first"; exit 1; fi
export PATH="$ROOT/fabric/fabric-samples/bin:$PATH"
cd "$NET"
./network.sh down
./network.sh up createChannel -c wethaq
# The chaincode runs as a service in its own container (built here with docker build), which avoids
# the peers building chaincode images through the Docker socket (unreliable on Docker Desktop for Mac).
./network.sh deployCCAAS -c wethaq -ccn wethaq -ccp "$ROOT/chaincode/shipment" \
  -ccep "AND('Org1MSP.peer','Org2MSP.peer')"
echo
echo "Fabric network is running with the wethaq chaincode."
echo "Next: in wethaq-api set LEDGER_MODE=fabric in .env, then run: npm run seed -- --reset && npm run dev"
