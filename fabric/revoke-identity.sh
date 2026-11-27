#!/usr/bin/env bash
# Revokes a client identity of Org1 or Org2, or one certificate of it, and makes the peers enforce it.
#
#   ./fabric/revoke-identity.sh <1|2> <identity name> [reason] [--yes]           every certificate of the identity
#   ./fabric/revoke-identity.sh <1|2> --certificate <cert.pem> [reason] [--yes]  one certificate only, for example the
#                                                                                previous certificate after renew-identities.sh
# Without --yes it asks for confirmation; --dry-run only runs the checks and changes nothing. reason is a CRL reason (default keycompromise; superseded for a renewal).
#
# Steps:
#   1. The organization's CA registrar revokes the certificate(s) and generates a new CRL.
#   2. The CRL is written into the organization's MSP definition on the channel (a channel configuration update,
#      signed by the organization's admin). From then on, peers reject proposals signed by a revoked certificate;
#      the configuration block records the change on the ledger.
#   3. A line is appended to fabric/identities/revocations.log (private, mode 600).
#
# Only client identities without registrar or revoker rights can be revoked here: peer, orderer and admin identities
# and the CA's registrar are refused, so that this script cannot lock an organization out of its own network.
# Revoking wethaq-app stops the API from submitting for that organization until a new identity is enrolled
# (see docs/gp482/BACKUP_AND_RECOVERY.md).
source "$(dirname "$0")/lib.sh"
require_samples
org="${1:-}"; shift || true
certfile=""; name=""
if [ "${1:-}" = "--certificate" ]; then certfile="${2:-}"; shift 2 || true; else name="${1:-}"; shift || true; fi
reason=keycompromise; confirm=""; dry=""
for a in "$@"; do case "$a" in --yes) confirm=--yes ;; --dry-run) dry=1 ;; *) reason="$a" ;; esac; done
case "$org" in 1) port=7054 ;; 2) port=8054 ;; *) echo "usage: $0 <1|2> <identity name> | --certificate <cert.pem> [reason] [--yes]" >&2; exit 2 ;; esac
if [ -n "$certfile" ]; then
  [ -f "$certfile" ] || { echo "no such certificate file" >&2; exit 2; }
  name=$(openssl x509 -in "$certfile" -noout -subject -nameopt multiline | sed -n 's/^ *commonName *= *//p')
  serial=$(openssl x509 -in "$certfile" -noout -serial | cut -d= -f2 | tr 'A-F' 'a-f')
  aki=$(openssl x509 -in "$certfile" -noout -ext authorityKeyIdentifier | tail -1 | tr -d ' :' | sed 's/^keyid//' | tr 'A-F' 'a-f')
fi
if ! [[ "$name" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then echo "invalid identity name" >&2; exit 2; fi
case "$reason" in unspecified|keycompromise|affiliationchanged|superseded|cessationofoperation|certificatehold|privilegewithdrawn) ;; *) echo "reason must be a CRL reason such as keycompromise or superseded" >&2; exit 2 ;; esac
msp="Org${org}MSP"
tls="$NET/organizations/fabric-ca/org$org/ca-cert.pem"
registrar="$NET/organizations/peerOrganizations/org$org.example.com"

# 0. Only client identities, never the network's own identities.
info=$(FABRIC_CA_CLIENT_HOME="$registrar" fabric-ca-client identity list --id "$name" --caname "ca-org$org" -u "https://localhost:$port" --tls.certfiles "$tls" 2>/dev/null || true)
type=$(echo "$info" | sed -n 's/.*Type: \([a-z]*\).*/\1/p' | head -1)
if [ -z "$type" ]; then echo "Org${org}MSP: no identity named $name at ca-org$org" >&2; exit 1; fi
if [ "$type" != "client" ]; then echo "Org${org}MSP: $name is a '$type' identity; only client identities are revoked by this script" >&2; exit 1; fi
if [ "$name" = "admin" ] || echo "$info" | grep -qE 'hf\.Registrar\.Roles Value:[^ ]|hf\.Revoker Value:(1|true)|hf\.GenCRL Value:(1|true)'; then
  echo "Org${org}MSP: $name can register or revoke identities (a CA registrar); it is not revoked by this script" >&2; exit 1
fi
what="every certificate of '$name'"; [ -n "$certfile" ] && what="certificate $serial of '$name'"
if [ -n "$dry" ]; then echo "Org${org}MSP: would revoke $what (reason $reason); nothing changed (--dry-run)"; exit 0; fi
if [ "$confirm" != "--yes" ]; then
  read -r -p "Revoke $what in Org${org}MSP (reason $reason)? This cannot be undone. Type the identity name to continue: " answer
  [ "$answer" = "$name" ] || { echo "Cancelled."; exit 1; }
fi

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
umask 077

# 1. Revoke at the CA and generate the CRL.
if [ -n "$certfile" ]; then
  target=(-s "$serial" -a "$aki"); serials="$serial"
else
  target=(-e "$name")
  serials=$(FABRIC_CA_CLIENT_HOME="$registrar" fabric-ca-client certificate list --id "$name" --caname "ca-org$org" -u "https://localhost:$port" \
    --tls.certfiles "$tls" 2>/dev/null | sed -n 's/.*Serial Number: .*(0x\([0-9a-f]*\)).*/\1/p' | tr '\n' ' ')
fi
FABRIC_CA_CLIENT_HOME="$registrar" fabric-ca-client revoke "${target[@]}" -r "$reason" --gencrl --caname "ca-org$org" \
  -u "https://localhost:$port" --tls.certfiles "$tls" > "$work/revoke.out" 2>&1 || { cat "$work/revoke.out" >&2; exit 1; }
crl="$registrar/msp/crls/crl.pem"
[ -s "$crl" ] || { echo "the CA did not write a CRL" >&2; exit 1; }

# 2. Put the CRL into the organization's MSP on the channel.
peer_env "$org"
orderer_ca="$NET/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
peer channel fetch config "$work/config_block.pb" -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
  -c "$CHANNEL" --tls --cafile "$orderer_ca" > "$work/fetch.out" 2>&1 || { cat "$work/fetch.out" >&2; exit 1; }
configtxlator proto_decode --input "$work/config_block.pb" --type common.Block | jq '.data.data[0].payload.data.config' > "$work/config.json"
crl_b64=$(base64 < "$crl" | tr -d '\n')
# The CA's CRL lists every certificate it has revoked, so it replaces the previous CRL of the same CA.
jq --arg crl "$crl_b64" --arg msp "$msp" '.channel_group.groups.Application.groups[$msp].values.MSP.value.config.revocation_list = [$crl]' \
  "$work/config.json" > "$work/modified.json"
configtxlator proto_encode --input "$work/config.json" --type common.Config --output "$work/config.pb"
configtxlator proto_encode --input "$work/modified.json" --type common.Config --output "$work/modified.pb"
if ! configtxlator compute_update --channel_id "$CHANNEL" --original "$work/config.pb" --updated "$work/modified.pb" --output "$work/update.pb" 2>/dev/null; then
  echo "$msp: the channel already has this CRL; nothing to update"
else
  configtxlator proto_decode --input "$work/update.pb" --type common.ConfigUpdate > "$work/update.json"
  jq -n --arg ch "$CHANNEL" --slurpfile u "$work/update.json" '{payload:{header:{channel_header:{channel_id:$ch,type:2}},data:{config_update:$u[0]}}}' > "$work/envelope.json"
  configtxlator proto_encode --input "$work/envelope.json" --type common.Envelope --output "$work/envelope.pb"
  peer channel update -f "$work/envelope.pb" -c "$CHANNEL" -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile "$orderer_ca" > "$work/update.out" 2>&1 || { cat "$work/update.out" >&2; exit 1; }
fi
height=$(peer channel getinfo -c "$CHANNEL" 2>/dev/null | sed -n 's/.*"height":\([0-9]*\).*/\1/p')

# 3. Audit record (private: it names identities).
mkdir -p "$IDENTITIES"
printf '{"at":"%s","org":"%s","identity":"%s","reason":"%s","revokedSerials":"%s","channel":"%s","channelHeightAfterUpdate":%s,"by":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msp" "$name" "$reason" "$(echo $serials)" "$CHANNEL" "${height:-null}" "${USER:-unknown}" >> "$IDENTITIES/revocations.log"
chmod 600 "$IDENTITIES/revocations.log"
echo "$msp: revoked $what ($reason); CRL with $(openssl crl -in "$crl" -noout -text | grep -c 'Serial Number') revoked certificate(s) is in the channel configuration (channel height ${height:-?})."
