#!/usr/bin/env bash
# Creates a fresh Wethaq network: Fabric CAs for both organizations and the orderer, one peer per organization,
# the channel, the shipment chaincode (as a service, endorsed by both organizations) and the application identities.
# Any previous test network and its ledger are removed first.
source "$(dirname "$0")/lib.sh"
require_samples
cd "$NET"
# The sample orderer waits up to 2 s to fill a block, so a single transaction takes about 2 s to commit.
# Wethaq submits one transaction per user action, so blocks are cut after 500 ms instead (blocks still close
# early when 10 transactions are waiting). This changes only the local test network's channel configuration.
sed -i.bak 's/^\( *BatchTimeout:\).*/\1 500ms/' configtx/configtx.yaml && rm -f configtx/configtx.yaml.bak
# The chaincode containers are started outside docker compose, so network.sh down does not always remove them.
docker rm -f $CCAAS_CONTAINERS >/dev/null 2>&1 || true
./network.sh down
rm -rf "$IDENTITIES"
# -ca: the organizations' identities are issued by Fabric CA servers (not cryptogen).
./network.sh up createChannel -ca -c "$CHANNEL"
"$FABRIC_DIR/deploy-chaincode.sh"
"$FABRIC_DIR/enroll-identities.sh"
"$FABRIC_DIR/verify-network.sh"
echo
echo "Fabric network is running with the $CC_NAME chaincode."
echo "Next, in wethaq-api (LEDGER_MODE=fabric in .env): npm run seed -- --reset && npm run dev"
