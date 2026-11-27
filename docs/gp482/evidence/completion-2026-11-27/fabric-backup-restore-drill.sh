#!/usr/bin/env bash
# Fabric backup and restore drill on the local, disposable test network (fabric-samples test-network).
# It REPLACES the local Fabric network (restore.sh --yes) and adds test shipments to the development database:
# run it on a disposable setup only. Output: stdout. Used for fabric-backup-restore.txt.
cd "$(dirname "$0")/../../../.."   # the repository root
D="${WETHAQ_DRILL_DIR:-/tmp/wethaq-drill}"; mkdir -p "$D"
export DATABASE_URL=postgres://wethaq:wethaq@127.0.0.1:5432/wethaq
API=http://localhost:4000/api
export WETHAQ_BACKUP_PASSPHRASE="$(openssl rand -hex 24)"   # random, for this drill only; never printed
say() { echo; echo "## $*"; }
start_api() { (cd wethaq-api && LEDGER_MODE=fabric setsid nohup npx tsx src/server.ts >> $D/api.log 2>&1 &); for i in $(seq 1 60); do curl -sf $API/health/ready >/dev/null && return 0; sleep 1; done; echo "API not ready"; return 1; }
stop_api() { pkill -f "^node .*tsx.*src/server.ts" || pkill -f "tsx src/server.ts$" || true; sleep 2; }
login() { curl -s $API/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1@wethaq.demo\",\"password\":\"demo\"}" | jq -r .token; }
height() { (source fabric/lib.sh; require_samples; peer_env 1; peer channel getinfo -c "$CHANNEL" 2>/dev/null) | grep -o '"height":[0-9]*' | cut -d: -f2; }
consistency() { curl -s $API/admin/consistency -H "authorization: Bearer $ADMIN" | jq -c '{consistent, ledgerHeight, checkpoint, summary, problems: [.problems[] | {shipmentId, status, differences, missingOnLedger: (.missingOnLedger|length), missingInDatabase: (.missingInDatabase|length)}]}'; }

echo "# Fabric backup and restore drill — $(date -u +%FT%TZ)"
echo "# Network: Hyperledger Fabric test-network (local, disposable). Channel wethaq, chaincode wethaq (CCAAS)."
stop_api 2>/dev/null
say "0. State before the backup"
start_api && echo "API started in Fabric mode"
ADMIN=$(login admin); PLANNER=$(login planner); DISPATCHER=$(login dispatcher)
echo "channel height: $(height)"
echo "consistency check before the backup:"; consistency
echo "shipments in PostgreSQL: $(psql $DATABASE_URL -Atc 'select count(*) from shipments')"

say "1. Encrypted backup (./fabric/backup.sh with WETHAQ_BACKUP_PASSPHRASE set)"
stop_api
./fabric/backup.sh $D/archives 2>&1
ARCHIVE=$(ls -t $D/archives/*.tar.enc | head -1)
echo "archive mode: $(stat -c %a "$ARCHIVE")"
echo "the archive is encrypted: $(head -c 8 "$ARCHIVE" | od -An -c | tr -s ' ')"
BACKUP_HEIGHT=$(height); echo "channel height after the backup (network started again): $BACKUP_HEIGHT"

say "2. Transactions after the backup (these will not be in the restored ledger)"
start_api
NEW=$(curl -s $API/shipments -H "authorization: Bearer $PLANNER" -H 'content-type: application/json' -d '{"partId":"SP-007","location":"Distribution Center","qty":4,"month":"2026-12","note":"Created after the backup (restore drill)"}')
echo "request: $(echo "$NEW" | jq -c '{id, block, ledgerState}')"
AFTER_ID=$(echo "$NEW" | jq -r .id)
echo "dispatch: $(curl -s $API/shipments/$AFTER_ID/dispatch -H "authorization: Bearer $DISPATCHER" -H 'content-type: application/json' -d '{"qty":4}' | jq -c '{passed, block, ledgerState}')"
sleep 2
echo "channel height now: $(height)"
echo "event checkpoint in PostgreSQL: $(psql $DATABASE_URL -Atc "select block from event_checkpoints where name='ledger-events'")"
stop_api

say "3. Restore from the backup (./fabric/restore.sh <archive> --yes)"
time ./fabric/restore.sh "$ARCHIVE" --yes 2>&1

say "4. Checks on the restored network"
echo "channel height: $(height) (backup: $BACKUP_HEIGHT)"
echo "--- docker containers"; docker ps --format '{{.Names}}\t{{.Status}}' | sort
echo "--- committed chaincode definition"; (source fabric/lib.sh; require_samples; committed_definition | jq -c '{version, sequence, endorsement_plugin, approvals}')
echo "--- a ledger record from before the backup: SHP-2026-0001 history"; ./fabric/query.sh history SHP-2026-0001 2>&1 | jq -c '.[] | {operation, status, quantity, org, txId: .txId[0:12]}' 2>&1 | head
echo "--- the shipment created after the backup is not on the restored ledger: $AFTER_ID"; ./fabric/query.sh shipment "$AFTER_ID" 2>&1 | head -3; echo "(empty = not found)"

say "5. API restarted on the restored ledger: checkpoint check"
start_api
ADMIN=$(login admin); PLANNER=$(login planner); DISPATCHER=$(login dispatcher)
curl -s $API/admin/sync-status -H "authorization: Bearer $ADMIN" | jq -c '{checkpoint, checkpointReset: .consumer.checkpointReset}'
echo "alert: $(psql $DATABASE_URL -Atc "select severity||' | '||title from alerts where dedupe_key='ledger-sync:checkpoint-ahead' and not acknowledged")"
curl -s $API/health/ready | jq -c .

say "6. Consistency check after the restore (read-only)"
consistency
echo "--- verify of the shipment created after the backup"
curl -s $API/shipments/$AFTER_ID/verify -H "authorization: Bearer $ADMIN" | jq -c '{status, onLedger, differences}'

say "7. New transactions on the restored ledger"
NEW2=$(curl -s $API/shipments -H "authorization: Bearer $PLANNER" -H 'content-type: application/json' -d '{"partId":"SP-008","location":"Deployment Site","qty":3,"month":"2026-12","note":"Created after the restore (restore drill)"}')
echo "request: $(echo "$NEW2" | jq -c '{id, block, ledgerState}')"
ID2=$(echo "$NEW2" | jq -r .id)
echo "dispatch: $(curl -s $API/shipments/$ID2/dispatch -H "authorization: Bearer $DISPATCHER" -H 'content-type: application/json' -d '{"qty":3}' | jq -c '{passed, block, ledgerState}')"
echo "rejected (quantity above requested): $(curl -s $API/shipments/$ID2/dispatch -H "authorization: Bearer $DISPATCHER" -H 'content-type: application/json' -d '{"qty":99}' | jq -c '{passed, failedRule, block}')"
sleep 3
echo "verify: $(curl -s $API/shipments/$ID2/verify -H "authorization: Bearer $ADMIN" | jq -c '{status, onLedger, match}')"
echo "event checkpoint: $(psql $DATABASE_URL -Atc "select block from event_checkpoints where name='ledger-events'") ; channel height: $(height)"

say "8. Consistency check after the new transactions"
consistency
stop_api
echo; echo "DONE $(date -u +%FT%TZ)"
