#!/usr/bin/env bash
# Starts a network that was stopped with ./fabric/stop.sh, with its existing ledger.
source "$(dirname "$0")/lib.sh"
require_samples
for c in $NETWORK_CONTAINERS; do
  if ! docker inspect "$c" >/dev/null 2>&1; then echo "No stopped network found ($c is missing). Create one with ./fabric/up.sh" >&2; exit 1; fi
done
docker start $NETWORK_CONTAINERS >/dev/null
sleep 3
if ! docker start $CCAAS_CONTAINERS >/dev/null 2>&1; then
  # Recreate the chaincode containers for the committed definition.
  run_ccaas "$(installed_package_id "${CC_NAME}_$(committed_definition | jq -r .version)")"
fi
"$FABRIC_DIR/verify-network.sh"
