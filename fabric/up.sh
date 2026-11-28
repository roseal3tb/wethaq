#!/usr/bin/env bash
# Creates a fresh Wethaq network: Fabric CAs for both organizations and the orderer, one peer per organization,
# the channel, the shipment chaincode (as a service, endorsed by both organizations) and the application identities.
# Any previous test network and its ledger are removed first, so this is not a restart command: an existing
# network is only replaced after confirmation (type 'recreate', or pass --recreate). To restart, use ./fabric/start.sh.
source "$(dirname "$0")/lib.sh"
require_samples
existing=""
for c in $NETWORK_CONTAINERS; do docker inspect "$c" >/dev/null 2>&1 && existing="$existing $c"; done
for v in compose_orderer.example.com compose_peer0.org1.example.com compose_peer0.org2.example.com; do
  docker volume inspect "$v" >/dev/null 2>&1 && existing="$existing volume:$v"
done
if [ -n "$existing" ] && [ "${1:-}" != "--recreate" ]; then
  echo "A Wethaq Fabric network already exists (${existing# }). up.sh would delete its ledger and identities." >&2
  echo "To restart it with its ledger, use ./fabric/start.sh. To back it up first, use ./fabric/backup.sh." >&2
  if [ -t 0 ]; then
    read -r -p "Type 'recreate' to delete it and create a new network: " answer
    [ "$answer" = "recreate" ] || { echo "Cancelled. Nothing was changed." >&2; exit 1; }
  else
    echo "Not interactive: nothing was changed. Run ./fabric/up.sh --recreate to replace it." >&2
    exit 1
  fi
fi
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
