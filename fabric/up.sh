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
# The sample network's orderer waits up to 2 s to fill a block, so a single transaction takes about 2 s to commit.
# Wethaq submits one transaction per user action, so blocks are cut after 500 ms instead (blocks still close
# early when 10 transactions are waiting). This changes only the local test network's channel configuration.
sed -i.bak 's/^\( *BatchTimeout:\).*/\1 500ms/' configtx/configtx.yaml && rm -f configtx/configtx.yaml.bak
# The chaincode containers are started outside docker compose, so network.sh down does not always remove them.
docker rm -f peer0org1_wethaq_ccaas peer0org2_wethaq_ccaas >/dev/null 2>&1 || true
./network.sh down
./network.sh up createChannel -c wethaq
# The chaincode runs as a service in its own container (built here with docker build), which avoids
# the peers building chaincode images through the Docker socket (unreliable on Docker Desktop for Mac).
./network.sh deployCCAAS -c wethaq -ccn wethaq -ccp "$ROOT/chaincode/shipment" \
  -ccep "AND('Org1MSP.peer','Org2MSP.peer')"
echo
echo "Fabric network is running with the wethaq chaincode."
echo "Next: in wethaq-api set LEDGER_MODE=fabric in .env, then run: npm run seed -- --reset && npm run dev"
