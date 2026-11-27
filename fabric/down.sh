#!/usr/bin/env bash
# Deletes the test network and its ledger (kept for compatibility; same as ./fabric/reset.sh --yes).
# To pause the network and keep the ledger, use ./fabric/stop.sh instead.
exec "$(dirname "$0")/reset.sh" --yes
