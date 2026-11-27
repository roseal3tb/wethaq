#!/usr/bin/env bash
# Stops the Fabric test network and deletes its ledger and crypto material.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/fabric/fabric-samples/bin:$PATH"
cd "$ROOT/fabric/fabric-samples/test-network" && ./network.sh down
# The chaincode containers are started outside docker compose, so network.sh down does not always remove them.
docker rm -f peer0org1_wethaq_ccaas peer0org2_wethaq_ccaas >/dev/null 2>&1 || true
