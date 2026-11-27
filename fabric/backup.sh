#!/usr/bin/env bash
# Backs up the Wethaq Fabric network: the ledger and world state of both peers (including the installed chaincode
# packages), the orderer's ledger, the network's crypto material and MSPs, the three Fabric CAs (keys and
# databases) and the application identities.
#
#   ./fabric/backup.sh [output directory]      default: fabric/backups/ (git-ignored)
#
# The network is stopped while the volumes are copied, so the copy is consistent, and started again afterwards
# (set WETHAQ_BACKUP_KEEP_STOPPED=1 to leave it stopped). The archive contains private keys: it is written with
# mode 600, and when WETHAQ_BACKUP_PASSPHRASE is set it is encrypted (AES-256-CBC, PBKDF2) and the plain archive is
# not kept. Restore with ./fabric/restore.sh <archive>.
source "$(dirname "$0")/lib.sh"
require_samples
umask 077
out_dir="${1:-$FABRIC_DIR/backups}"
mkdir -p "$out_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
TOOLS_IMAGE="${WETHAQ_BACKUP_IMAGE:-hyperledger/fabric-tools:2.5}"
VOLUMES="compose_orderer.example.com compose_peer0.org1.example.com compose_peer0.org2.example.com"

for v in $VOLUMES; do docker volume inspect "$v" >/dev/null 2>&1 || { echo "volume $v not found: is the network created (./fabric/up.sh)?" >&2; exit 1; }; done

# What the backup contains, read while the network is running.
peer_env 1
height=$(peer channel getinfo -c "$CHANNEL" 2>/dev/null | sed -n 's/.*"height":\([0-9]*\).*/\1/p')
def=$(committed_definition)
version=$(echo "$def" | jq -r .version); sequence=$(echo "$def" | jq -r .sequence)
cd "$FABRIC_DIR"

echo "Stopping the network for a consistent copy (channel $CHANNEL at height ${height:-?})"
"$FABRIC_DIR/stop.sh" >/dev/null
mkdir -p "$work/volumes"
for v in $VOLUMES; do
  docker run --rm -v "$v":/data:ro -v "$work/volumes":/backup --entrypoint tar "$TOOLS_IMAGE" czf "/backup/$v.tgz" -C /data .
done
tar czf "$work/organizations.tgz" -C "$NET" organizations
if [ -d "$IDENTITIES" ]; then tar czf "$work/identities.tgz" -C "$FABRIC_DIR" identities; fi
if [ "${WETHAQ_BACKUP_KEEP_STOPPED:-}" != "1" ]; then "$FABRIC_DIR/start.sh" >/dev/null && echo "Network started again"; fi

jq -n --arg at "$stamp" --arg channel "$CHANNEL" --arg cc "$CC_NAME" --arg version "$version" --arg sequence "$sequence" \
  --arg height "${height:-0}" --arg fabric "$(peer version 2>/dev/null | sed -n 's/^ Version: //p' | head -1)" \
  '{createdAt:$at, channel:$channel, chaincode:$cc, chaincodeVersion:$version, chaincodeSequence:($sequence|tonumber), channelHeight:($height|tonumber), fabricVersion:$fabric}' \
  > "$work/manifest.json"
(cd "$work" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

archive="$out_dir/wethaq-fabric-$stamp.tar"
tar cf "$archive" -C "$work" .
if [ -n "${WETHAQ_BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$archive" -out "$archive.enc" -pass env:WETHAQ_BACKUP_PASSPHRASE
  rm -f "$archive"; archive="$archive.enc"
else
  echo "Note: the archive is not encrypted (set WETHAQ_BACKUP_PASSPHRASE to encrypt it). It contains private keys: keep it private."
fi
chmod 600 "$archive"
echo "Backup written: $archive ($(du -h "$archive" | cut -f1)), channel height $height, chaincode $CC_NAME $version (sequence $sequence)"
echo "sha256 $(sha256sum "$archive" | cut -d' ' -f1)"
