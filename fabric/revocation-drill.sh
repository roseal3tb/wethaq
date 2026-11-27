#!/usr/bin/env bash
# Revocation drill with a disposable identity. Nothing existing is revoked.
#   1. registers and enrolls a new client identity (wethaq-revoke-drill-<time>) with ca-org1;
#   2. shows that it can query and submit a transaction;
#   3. re-enrolls it (a second certificate, as renew-identities.sh does) and revokes only the first certificate
#      (reason superseded): the first is refused, the second still works;
#   4. revokes the whole identity (keycompromise): its queries and transactions are refused by the peers;
#   5. shows that wethaq-app and the organization admin still work.
# The submitted transaction is a Dispatch of the non-existent shipment SHP-REVOKE-DRILL, which the chaincode
# records as a rejected attempt (validReference): it changes no shipment.
source "$(dirname "$0")/lib.sh"
require_samples
umask 077
name="wethaq-revoke-drill-$(date -u +%Y%m%d%H%M%S)"
dir="$IDENTITIES/org1/$name"
tls="$NET/organizations/fabric-ca/org1/ca-cert.pem"
orderer_ca="$NET/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
peer1_ca="$NET/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem"
peer2_ca="$NET/organizations/peerOrganizations/org2.example.com/tlsca/tlsca.org2.example.com-cert.pem"
fail=0
pass() { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; fail=1; }

as_msp() { # $1 = MSP folder of an Org1 identity
  export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP CORE_PEER_MSPCONFIGPATH="$1" \
    CORE_PEER_TLS_ROOTCERT_FILE="$peer1_ca" CORE_PEER_ADDRESS=localhost:7051
}
query() { peer chaincode query -C "$CHANNEL" -n "$CC_NAME" -c '{"function":"GetHistory","Args":["SHP-REVOKE-DRILL"]}' 2>&1 || true; }
invoke() {
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$orderer_ca" \
    -C "$CHANNEL" -n "$CC_NAME" --peerAddresses localhost:7051 --tlsRootCertFiles "$peer1_ca" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$peer2_ca" --waitForEvent \
    -c '{"function":"Dispatch","Args":["SHP-REVOKE-DRILL","1"]}' 2>&1 || true
}

echo "Revocation drill on channel $CHANNEL with the disposable identity $name"
# 1. A new client identity from the Org1 CA.
export FABRIC_CA_CLIENT_HOME="$NET/organizations/peerOrganizations/org1.example.com"
secret=$(openssl rand -hex 16)
fabric-ca-client register --caname ca-org1 --id.name "$name" --id.secret "$secret" --id.type client \
  --tls.certfiles "$tls" >/dev/null 2>&1
fabric-ca-client enroll -u "https://$name:$secret@localhost:7054" --caname ca-org1 -M "$dir/msp" --tls.certfiles "$tls" >/dev/null 2>&1
cp "$NET/organizations/peerOrganizations/org1.example.com/msp/config.yaml" "$dir/msp/config.yaml"
unset FABRIC_CA_CLIENT_HOME
serial=$(openssl x509 -in "$dir/msp/signcerts/cert.pem" -noout -serial | cut -d= -f2)
echo "  enrolled, certificate serial $serial"

# 2. Before revocation.
cd "$NET"
as_msp "$dir/msp"
out=$(query); if [ "$out" = "[]" ] || echo "$out" | grep -q '^\['; then pass "before: the new identity can query"; else bad "before: query failed: $out"; fi
out=$(invoke); if echo "$out" | grep -q 'status:200'; then pass "before: the new identity can submit (committed; the chaincode recorded a rejected attempt for the unknown shipment)"; else bad "before: invoke failed: $out"; fi

# 3. A second certificate, then revoke only the first one.
cp -R "$dir/msp" "$dir/msp2"
FABRIC_CA_CLIENT_HOME="$dir" fabric-ca-client reenroll -u https://localhost:7054 --caname ca-org1 -M "$dir/msp2" --tls.certfiles "$tls" >/dev/null 2>&1
serial2=$(openssl x509 -in "$dir/msp2/signcerts/cert.pem" -noout -serial | cut -d= -f2)
echo "  re-enrolled, second certificate serial $serial2"
"$FABRIC_DIR/revoke-identity.sh" 1 --certificate "$dir/msp/signcerts/cert.pem" superseded --yes | sed 's/^/  /'
sleep 2
cd "$NET"
as_msp "$dir/msp"
out=$(query); if echo "$out" | grep -qi 'access denied'; then pass "first certificate (superseded) refused"; else bad "first certificate was not refused: $out"; fi
as_msp "$dir/msp2"
out=$(query); if echo "$out" | grep -q '^\['; then pass "second certificate of the same identity still works"; else bad "second certificate failed: $out"; fi

# 3b. Revoke the whole identity.
"$FABRIC_DIR/revoke-identity.sh" 1 "$name" keycompromise --yes | sed 's/^/  /'
sleep 2

# 4. After revocation of the identity.
cd "$NET"
as_msp "$dir/msp2"
out=$(query); if echo "$out" | grep -qiE 'revoked|access denied|creator.*(invalid|unknown)|could not be validated'; then pass "after: query refused ($(echo "$out" | grep -oiE 'revoked|access denied' | head -1))"; else bad "after: query was not refused: $out"; fi
out=$(invoke); if echo "$out" | grep -qiE 'revoked|access denied|endorsement failure|could not be validated'; then pass "after: transaction refused ($(echo "$out" | grep -oiE 'revoked|access denied|endorsement failure' | head -1))"; else bad "after: transaction was not refused: $out"; fi

n=$(docker logs --since 2m peer0.org1.example.com 2>&1 | grep "CN=$name" | grep -c 'The certificate has been revoked' || true)
if [ "$n" -gt 0 ]; then pass "peer0.org1 log gives the reason: 'The certificate has been revoked' ($n refusal(s) for CN=$name)"; else bad "peer0.org1 log has no revocation message for CN=$name"; fi

# 5. Other identities are unaffected.
as_msp "$IDENTITIES/org1/$APP_USER/msp"
out=$(query); if echo "$out" | grep -q '^\['; then pass "after: wethaq-app (Org1) still queries"; else bad "after: wethaq-app query failed: $out"; fi
out=$("$FABRIC_DIR/query.sh" history SHP-REVOKE-DRILL 2>&1 || true); if echo "$out" | grep -q '^\['; then pass "after: the Org2 admin still queries ($(echo "$out" | jq length) record(s) for SHP-REVOKE-DRILL)"; else bad "after: admin query failed: $out"; fi

if [ $fail = 0 ]; then echo "Revocation drill passed."; else echo "Revocation drill FAILED."; fi
exit $fail
