#!/usr/bin/env bash
# Deploys a changed chaincode as the next definition (new version label, sequence + 1). The ledger is kept.
# Usage: ./fabric/upgrade-chaincode.sh [version]   (default: 1.<next sequence>)
source "$(dirname "$0")/lib.sh"
require_samples
CURRENT=$(committed_definition | jq -r '.sequence // 0')
if [ "$CURRENT" = "0" ]; then echo "No $CC_NAME definition is committed on $CHANNEL. Run ./fabric/up.sh first." >&2; exit 1; fi
NEXT=$((CURRENT + 1))
"$FABRIC_DIR/deploy-chaincode.sh" "${1:-1.$NEXT}" "$NEXT"
"$FABRIC_DIR/verify-network.sh"
