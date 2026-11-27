#!/usr/bin/env bash
# One-time setup: downloads the Hyperledger Fabric samples, binaries and Docker images into fabric/fabric-samples.
exec "$(dirname "$0")/install.sh" "$@"
