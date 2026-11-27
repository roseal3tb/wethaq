#!/usr/bin/env bash
# Checks that the Wethaq network is usable: containers running, the channel joined by both peers, the chaincode
# definition committed with both approvals, the chaincode answering a query, and application identities valid.
source "$(dirname "$0")/lib.sh"
require_samples
fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }
echo "Wethaq Fabric network ($CHANNEL / $CC_NAME)"
for c in $NETWORK_CONTAINERS $CCAAS_CONTAINERS; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then ok "container $c"; else bad "container $c is not running"; fi
done
for org in 1 2; do
  peer_env $org
  if peer channel list 2>/dev/null | grep -qx "$CHANNEL"; then ok "peer0.org$org joined $CHANNEL"; else bad "peer0.org$org has not joined $CHANNEL"; fi
done
def=$(committed_definition)
if [ -n "$def" ] && [ "$(echo "$def" | jq -r '.approvals.Org1MSP and .approvals.Org2MSP')" = "true" ]; then
  ok "chaincode definition sequence $(echo "$def" | jq -r .sequence), version $(echo "$def" | jq -r .version), approved by Org1MSP and Org2MSP"
else bad "chaincode definition is not committed with both approvals"; fi
peer_env 1
# macOS has no "timeout" command, so the time limit is used only where it exists. The chaincode containers can
# need a few seconds after a start before they answer, so the query is tried up to five times.
limit() { if command -v timeout >/dev/null 2>&1; then timeout 30 "$@"; else "$@"; fi; }
answered=no
for attempt in 1 2 3 4 5; do
  if limit peer chaincode query -C "$CHANNEL" -n "$CC_NAME" -c '{"function":"GetHistory","Args":["SHP-VERIFY-NETWORK"]}' >/dev/null 2>&1; then answered=yes; break; fi
  sleep 3
done
if [ "$answered" = yes ]; then ok "chaincode answers queries"; else bad "chaincode does not answer queries"; fi
for org in 1 2; do
  cert="$IDENTITIES/org$org/$APP_USER/msp/signcerts/cert.pem"
  if [ ! -f "$cert" ]; then bad "Org${org}MSP application identity missing (run ./fabric/enroll-identities.sh)"; continue; fi
  if openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null; then ok "Org${org}MSP $APP_USER certificate valid for 30+ days"; else bad "Org${org}MSP $APP_USER certificate expires within 30 days (re-enroll)"; fi
done
exit $fail
