#!/usr/bin/env bash
# Deletes the test network and its ledger (kept for compatibility; same as ./fabric/reset.sh, which asks
# you to type 'reset' unless --yes is given). To pause the network and keep the ledger, use ./fabric/stop.sh.
exec "$(dirname "$0")/reset.sh" "$@"
