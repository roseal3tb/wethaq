#!/usr/bin/env bash
# One-time setup: downloads the Hyperledger Fabric samples, binaries and Docker images (Fabric 2.5, CA 1.5)
# into fabric/fabric-samples. Needs Docker Desktop running. Takes a few minutes the first time.
set -euo pipefail
cd "$(dirname "$0")"
FABRIC_VERSION=2.5.12
CA_VERSION=1.5.15
if [ ! -f install-fabric.sh ]; then
  curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
fi
./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" docker samples binary
echo
echo "Fabric is installed. Start the Wethaq network with: ./fabric/up.sh"
