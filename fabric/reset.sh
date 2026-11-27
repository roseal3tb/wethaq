#!/usr/bin/env bash
# Deletes the Wethaq test network: its containers, ledger volumes, generated crypto material and application
# identities. Only the fabric-samples test network and the Wethaq chaincode containers are touched.
# Asks for confirmation unless --yes is given.
source "$(dirname "$0")/lib.sh"
require_samples
if [ "${1:-}" != "--yes" ]; then
  read -r -p "This deletes the Wethaq Fabric ledger and identities. Type 'reset' to continue: " answer
  [ "$answer" = "reset" ] || { echo "Cancelled."; exit 1; }
fi
docker rm -f $CCAAS_CONTAINERS >/dev/null 2>&1 || true
cd "$NET" && ./network.sh down
rm -rf "$IDENTITIES"
echo "Fabric network deleted. Create a new one with ./fabric/up.sh, then run npm run seed -- --reset in wethaq-api."
