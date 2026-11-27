#!/usr/bin/env bash
# Starts the Fabric test network (Org1 = issuing, Org2 = receiving, one orderer), creates the
# "wethaq" channel and deploys the shipment chaincode with an endorsement policy that needs both
# organizations. Any previous network and its ledger are removed first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="$ROOT/fabric/fabric-samples/test-network"
if [ ! -d "$NET" ]; then echo "Run ./fabric/install.sh first"; exit 1; fi
export PATH="$ROOT/fabric/fabric-samples/bin:$PATH"
cd "$NET"
./network.sh down
./network.sh up createChannel -c wethaq
./network.sh deployCC -c wethaq -ccn wethaq -ccp "$ROOT/chaincode/shipment" -ccl typescript \
  -ccep "AND('Org1MSP.peer','Org2MSP.peer')"
echo
echo "Fabric network is running with the wethaq chaincode."
echo "Next: in wethaq-api set LEDGER_MODE=fabric in .env, then run: npm run seed -- --reset && npm run dev"
