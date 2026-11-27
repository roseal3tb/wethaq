#!/usr/bin/env bash
# Shared settings for the Wethaq Fabric scripts. Sourced, not run.
# Development and academic demonstration network only (fabric-samples test-network): one peer per
# organization, one Raft orderer, Fabric CAs on localhost. It is not a highly available production deployment.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_DIR="$ROOT/fabric"
NET="$FABRIC_DIR/fabric-samples/test-network"
CHANNEL="${FABRIC_CHANNEL:-wethaq}"
CC_NAME="${FABRIC_CHAINCODE:-wethaq}"
CC_SRC="$ROOT/chaincode/shipment"
# Every shipment transaction must be endorsed by a peer of both organizations.
CC_POLICY="AND('Org1MSP.peer','Org2MSP.peer')"
# Application identities enrolled from the Fabric CAs (never committed; see .gitignore).
IDENTITIES="$FABRIC_DIR/identities"
APP_USER="${FABRIC_APP_USER:-wethaq-app}"
CCAAS_CONTAINERS="peer0org1_${CC_NAME}_ccaas peer0org2_${CC_NAME}_ccaas"
NETWORK_CONTAINERS="orderer.example.com peer0.org1.example.com peer0.org2.example.com ca_org1 ca_org2 ca_orderer"

require_samples() {
  if [ ! -d "$NET" ]; then echo "Fabric is not installed. Run ./fabric/setup.sh first." >&2; exit 1; fi
  export PATH="$FABRIC_DIR/fabric-samples/bin:$PATH"
  export FABRIC_CFG_PATH="$FABRIC_DIR/fabric-samples/config"
}

# Peer CLI environment for an organization's admin (used only for channel and chaincode lifecycle tasks).
peer_env() {
  cd "$NET"
  export TEST_NETWORK_HOME="$NET"
  # The samples' envVar.sh is not written for "set -u", so it is sourced with that option off.
  export OVERRIDE_ORG="${OVERRIDE_ORG:-}" VERBOSE="${VERBOSE:-false}"
  set +u
  # shellcheck disable=SC1091
  . "$NET/scripts/envVar.sh" >/dev/null
  setGlobals "$1" >/dev/null
  set -u
}

orderer_args() { echo "-o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile $NET/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"; }

# The chaincode package id the peers have installed for the committed definition.
installed_package_id() {
  peer_env 1
  peer lifecycle chaincode queryinstalled --output json | jq -r --arg label "$1" '.installed_chaincodes[]? | select(.label == $label) | .package_id' | tail -1
}

committed_definition() {
  peer_env 1
  peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" --output json 2>/dev/null || true
}

# Runs one chaincode-as-a-service container per peer. They restart with Docker unless stopped explicitly.
run_ccaas() {
  local pkg="$1"
  for org in 1 2; do
    docker rm -f "peer0org${org}_${CC_NAME}_ccaas" >/dev/null 2>&1 || true
    docker run -d --restart unless-stopped --name "peer0org${org}_${CC_NAME}_ccaas" --network fabric_test \
      -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 -e CHAINCODE_ID="$pkg" -e CORE_CHAINCODE_ID_NAME="$pkg" \
      "${CC_NAME}_ccaas_image:latest" >/dev/null
  done
}
