#!/usr/bin/env bash
# Renews the application identities (wethaq-app) before their certificates expire: re-enrolls each one with its
# organization's Fabric CA, which issues a new certificate and a new private key for the same identity.
# The previous MSP folder is kept next to it (…/wethaq-app.<timestamp>, readable by the current user only) so the
# change can be rolled back. Restart the API afterwards so that it loads the new identity.
# Usage: ./fabric/renew-identities.sh            (both organizations)
#        ./fabric/renew-identities.sh 1          (Org1 only)
source "$(dirname "$0")/lib.sh"
require_samples
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for org in ${1:-1 2}; do
  case $org in 1) port=7054 ;; 2) port=8054 ;; *) echo "organization must be 1 or 2" >&2; exit 2 ;; esac
  dir="$IDENTITIES/org$org/$APP_USER"
  if [ ! -f "$dir/msp/signcerts/cert.pem" ]; then echo "Org${org}MSP: $APP_USER is not enrolled; run ./fabric/enroll-identities.sh" >&2; exit 1; fi
  tls="$NET/organizations/fabric-ca/org$org/ca-cert.pem"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  # fabric-ca-client signs the re-enrollment request with the current identity, then writes the new certificate and
  # key into the same folder: the work is done on a copy, and the copy replaces the original only on success.
  cp -R "$dir/msp" "$work/new"
  FABRIC_CA_CLIENT_HOME="$work" fabric-ca-client reenroll -u "https://localhost:$port" --caname "ca-org$org" \
    -M "$work/new" --tls.certfiles "$tls" >/dev/null 2>"$work/log" || { cat "$work/log" >&2; exit 1; }
  newkey=$(ls -t "$work/new/keystore/" | grep -v '^key.pem$' | head -1 || true)
  if [ -n "$newkey" ]; then mv "$work/new/keystore/$newkey" "$work/new/keystore/key.pem"; fi
  old_end=$(openssl x509 -in "$dir/msp/signcerts/cert.pem" -noout -enddate | cut -d= -f2)
  mv "$dir" "$dir.$stamp"
  mkdir -p "$dir"
  mv "$work/new" "$dir/msp"
  rm -rf "$work"; trap - EXIT
  echo "Org${org}MSP: renewed $APP_USER (was valid until $old_end; now $(openssl x509 -in "$dir/msp/signcerts/cert.pem" -noout -enddate | cut -d= -f2)); previous identity kept in $(basename "$dir.$stamp")"
done
echo "Restart the API to use the renewed identities."
