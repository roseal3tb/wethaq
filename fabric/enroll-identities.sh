#!/usr/bin/env bash
# Registers and enrolls one client identity per organization with that organization's Fabric CA. The API signs
# transactions with these identities (never with an admin identity). Private keys stay in fabric/identities/
# (git-ignored, readable by the current user only). Safe to re-run: an existing enrollment is kept.
source "$(dirname "$0")/lib.sh"
require_samples
umask 077
for org in 1 2; do
  case $org in 1) port=7054 ;; 2) port=8054 ;; esac
  dir="$IDENTITIES/org$org/$APP_USER"
  if [ -f "$dir/msp/signcerts/cert.pem" ]; then echo "Org${org}MSP: $APP_USER already enrolled"; continue; fi
  tls="$NET/organizations/fabric-ca/org$org/ca-cert.pem"
  # The CA registrar (enrolled by network.sh into the organization folder) registers the application identity.
  export FABRIC_CA_CLIENT_HOME="$NET/organizations/peerOrganizations/org$org.example.com"
  secret=$(openssl rand -hex 16)
  fabric-ca-client register --caname "ca-org$org" --id.name "$APP_USER" --id.secret "$secret" --id.type client \
    --id.attrs 'wethaq.role=application:ecert' --tls.certfiles "$tls" >/dev/null
  mkdir -p "$dir"
  fabric-ca-client enroll -u "https://$APP_USER:$secret@localhost:$port" --caname "ca-org$org" -M "$dir/msp" --tls.certfiles "$tls" >/dev/null
  cp "$NET/organizations/peerOrganizations/org$org.example.com/msp/config.yaml" "$dir/msp/config.yaml"
  mv "$dir/msp/keystore/"*_sk "$dir/msp/keystore/key.pem"
  echo "Org${org}MSP: enrolled $APP_USER ($(openssl x509 -in "$dir/msp/signcerts/cert.pem" -noout -enddate))"
done
