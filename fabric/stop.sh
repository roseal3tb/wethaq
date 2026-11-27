#!/usr/bin/env bash
# Stops the network containers but keeps the ledger, identities and channel. Resume with ./fabric/start.sh.
source "$(dirname "$0")/lib.sh"
docker stop $CCAAS_CONTAINERS $NETWORK_CONTAINERS >/dev/null 2>&1 || true
echo "Fabric network stopped (ledger kept). Start it again with ./fabric/start.sh"
