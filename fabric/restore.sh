#!/usr/bin/env bash
# Restores the Wethaq Fabric network from an archive made by ./fabric/backup.sh. It REPLACES the current network:
# its containers, ledger volumes, crypto material, CAs and identities are deleted first (only Fabric resources;
# nothing else in Docker is touched). Asks you to type 'restore' unless --yes is given.
#
#   ./fabric/restore.sh <archive.tar | archive.tar.enc> [--yes]     (WETHAQ_BACKUP_PASSPHRASE for .enc archives)
#
# The chaincode image (wethaq_ccaas_image) must exist locally; if it does not, build it first with
#   docker build -t wethaq_ccaas_image:latest chaincode/shipment
# After the restore, PostgreSQL may be AHEAD of the restored ledger (transactions committed after the backup).
# Check with GET /api/admin/consistency (see docs/gp482/BACKUP_AND_RECOVERY.md).
source "$(dirname "$0")/lib.sh"
require_samples
umask 077
archive="${1:-}"; confirm="${2:-}"
[ -f "$archive" ] || { echo "usage: $0 <archive> [--yes]" >&2; exit 2; }
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
TOOLS_IMAGE="${WETHAQ_BACKUP_IMAGE:-hyperledger/fabric-tools:2.5}"
docker image inspect "${CC_NAME}_ccaas_image:latest" >/dev/null 2>&1 || { echo "Build the chaincode image first: docker build -t ${CC_NAME}_ccaas_image:latest chaincode/shipment" >&2; exit 1; }

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
if [[ "$archive" == *.enc ]]; then
  [ -n "${WETHAQ_BACKUP_PASSPHRASE:-}" ] || { echo "set WETHAQ_BACKUP_PASSPHRASE to decrypt the archive" >&2; exit 1; }
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$archive" -out "$work/archive.tar" -pass env:WETHAQ_BACKUP_PASSPHRASE
  tar xf "$work/archive.tar" -C "$work"; rm -f "$work/archive.tar"
else
  tar xf "$archive" -C "$work"
fi
(cd "$work" && sha256sum -c --quiet SHA256SUMS) || { echo "The archive is damaged: checksums do not match" >&2; exit 1; }
echo "Archive: $(jq -c . "$work/manifest.json")"
if [ "$confirm" != "--yes" ]; then
  read -r -p "This replaces the current Fabric network, ledger and identities with the backup. Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
fi

echo "Removing the current network"
"$FABRIC_DIR/reset.sh" --yes >/dev/null 2>&1

echo "Restoring crypto material, CAs and identities"
rm -rf "$NET/organizations"
tar xzf "$work/organizations.tgz" -C "$NET"
if [ -f "$work/identities.tgz" ]; then tar xzf "$work/identities.tgz" -C "$FABRIC_DIR"; fi

echo "Recreating the containers and restoring the ledger volumes"
cd "$NET"
COMPOSE=(docker compose -f compose/compose-test-net.yaml -f compose/docker/docker-compose-test-net.yaml -f compose/compose-ca.yaml)
DOCKER_SOCK=/var/run/docker.sock "${COMPOSE[@]}" create >/dev/null 2>&1
for f in "$work"/volumes/*.tgz; do
  v=$(basename "$f" .tgz)
  docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v" >/dev/null
  docker run --rm -v "$v":/data -v "$work/volumes":/backup:ro --entrypoint sh "$TOOLS_IMAGE" -c "cd /data && tar xzf /backup/$v.tgz"
done
DOCKER_SOCK=/var/run/docker.sock "${COMPOSE[@]}" up -d >/dev/null 2>&1
sleep 5
version=$(jq -r .chaincodeVersion "$work/manifest.json")
run_ccaas "$(installed_package_id "${CC_NAME}_${version}")"
wait_for_orderer
"$FABRIC_DIR/verify-network.sh"
peer_env 1
echo "Channel height after restore: $(peer channel getinfo -c "$CHANNEL" 2>/dev/null | sed -n 's/.*"height":\([0-9]*\).*/\1/p') (backup: $(jq -r .channelHeight "$work/manifest.json"))"
