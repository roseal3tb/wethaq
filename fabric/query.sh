#!/usr/bin/env bash
# Reads the ledger directly from a peer with the peer CLI, without the Wethaq API or PostgreSQL.
#   ./fabric/query.sh tx <64-hex transaction id>   the transaction record the chaincode stored for that id
#   ./fabric/query.sh history <shipment id>        every transaction record of a shipment
#   ./fabric/query.sh shipment <shipment id>       the shipment's current state on the ledger
# The query runs on peer0 of the organization in WETHAQ_QUERY_ORG (1 or 2, default 2). Output is JSON ('' when absent).
source "$(dirname "$0")/lib.sh"
require_samples
case "${1:-}" in
  tx) fn=ReadTransactionRecord ;;
  history) fn=GetHistory ;;
  shipment) fn=ReadShipment ;;
  *) echo "usage: $0 tx <txId> | history <shipmentId> | shipment <shipmentId>" >&2; exit 2 ;;
esac
arg="${2:-}"
if ! [[ "$arg" =~ ^[A-Za-z0-9-]{1,64}$ ]]; then echo "invalid identifier" >&2; exit 2; fi
peer_env "${WETHAQ_QUERY_ORG:-2}"
peer chaincode query -C "$CHANNEL" -n "$CC_NAME" -c "{\"function\":\"$fn\",\"Args\":[\"$arg\"]}"
