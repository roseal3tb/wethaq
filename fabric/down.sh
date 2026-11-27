#!/usr/bin/env bash
# Stops the Fabric test network and deletes its ledger and crypto material.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/fabric/fabric-samples/bin:$PATH"
cd "$ROOT/fabric/fabric-samples/test-network" && ./network.sh down
