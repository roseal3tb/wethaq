# Wethaq: backup, restore, revocation and recovery

This page covers what to back up, how to restore it, how to revoke a Fabric identity, and what to do after each kind
of failure. Each procedure is marked **executed** (with its evidence file) or **documented only**. Everything was
executed on the single-machine Fabric test network used for development. Nothing here was run on a hosted server. Cloud deployment is deferred to GP2; on the planned Oracle Cloud Always
Free server, backups must be copied off the instance (Always Free instances can be reclaimed when idle; see
[ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md) §3 and §7, step 21).

## 1. What holds what

| Store | Holds | Lost if not backed up |
| --- | --- | --- |
| Fabric ledger (peer and orderer volumes) | every accepted and rejected shipment operation, the shipment state, the chaincode definition, channel configuration including CRLs | the authoritative record. Each organization's peer holds a full copy, so losing one peer is recoverable from the other |
| Fabric crypto material, CAs, MSPs | the network's keys and certificates, CA databases (who was enrolled and revoked) | the ability to run or extend the existing network |
| `fabric/identities/` | the API's client identities (private keys), `revocations.log` | the API's ability to submit (a new identity can be enrolled) |
| PostgreSQL | users and password hashes, roles, parts, inventory, alerts, review notes, the audit log, the reporting copy of every ledger record, the event checkpoint | everything that is not on the ledger. The ledger part can be re-read from Fabric |
| `deploy/production.env` or `wethaq-api/.env` | `JWT_SECRET`, database password, settings | sessions (a new secret signs everyone out). Keep it in a password manager, not in a backup next to the data |

`fabric/backups/`, `.env` files and `deploy/production.env` are git-ignored. Archives contain private keys and
must be stored privately.

## 2. PostgreSQL

**Backup and restore: executed.**

```bash
# backup (the API may keep running)
pg_dump --format=custom --no-owner "$DATABASE_URL" -f wethaq-$(date -u +%Y%m%dT%H%M%SZ).dump
# Docker database of wethaq-api/docker-compose.yml:   docker exec wethaq-api-db pg_dump -U wethaq -Fc wethaq > wethaq.dump
# deploy/compose.yml:   docker compose -f deploy/compose.yml --env-file deploy/production.env exec -T postgres pg_dump -U wethaq -Fc wethaq > wethaq.dump

# restore into a NEW, empty database, then point DATABASE_URL at it
createdb -O wethaq wethaq_restore
pg_restore --no-owner -d postgres://wethaq:<password>@<host>:<port>/wethaq_restore wethaq.dump
```

Use `pg_dump` and `pg_restore` of the same major version as the server, for example the ones inside the PostgreSQL container. A dump written by a newer client can contain settings that an older server refuses (PostgreSQL 16 refuses `transaction_timeout`, which version 17 writes). This happened in the first GitHub Actions run.

Never restore over the database that is in use. Restore into a new one, check it, then switch `DATABASE_URL`.

* An isolated dump and restore of the development database gave identical row counts and content checksums for
  every table ([evidence](evidence/completion-2026-11-27/postgres-init-backup-restore.txt)). The same file shows a
  clean initialization of an empty database: migrations applied twice (the second run does nothing), then seeded.
* After a restore the copy is older than the ledger. When the API starts, its event consumer reads the ledger from
  the block in `event_checkpoints` and applies every transaction committed since the backup, exactly once. This was
  executed on the real network: a dispatch committed after the backup was applied to the restored copy
  ([evidence](evidence/backup-restore-renewal-2026-11-27.md)).
* What cannot be recovered from the ledger: users, inventory changes, alerts, notes and audit rows written after the
  backup.

CI repeats the dump and restore on every pull request (job *migrations*). Its first GitHub run failed because of the version mismatch described above. It now uses the container's own tools and passes.

## 3. Fabric network

**Backup and restore: executed.** The scripts copy the whole test network: both peers' ledgers and world state
(with the installed chaincode packages), the orderer's ledger, the crypto material and MSPs, the three CAs and the
application identities.

```bash
export WETHAQ_BACKUP_PASSPHRASE='<long passphrase, kept in a password manager>'   # optional; encrypts the archive
./fabric/backup.sh                 # stops the network for a consistent copy, then starts it again
#   -> fabric/backups/wethaq-fabric-<UTC time>.tar.enc (mode 600; without a passphrase: .tar, still mode 600)

./fabric/restore.sh fabric/backups/wethaq-fabric-<UTC time>.tar.enc   # asks you to type: restore
```

`restore.sh` replaces the current network: it deletes only the Fabric containers, volumes and crypto material,
then waits until the orderer has elected a leader before it checks the network. The chaincode image
`wethaq_ccaas_image` must exist locally (`docker build -t wethaq_ccaas_image:latest chaincode/shipment`).

The drill ([evidence](evidence/completion-2026-11-27/fabric-backup-restore.txt)) did the following on the real
network:

1. Made an encrypted backup at channel height 25.
2. Committed shipment SHP-2026-0049 after the backup.
3. Restored. The channel height was 25 again and records from before the backup were intact. SHP-2026-0049 was not
   on the restored ledger, as expected.
4. Restarted the API, which detected that its checkpoint was ahead of the ledger (next section).
5. Committed new transactions on the restored ledger, including a rejected one.

Two earlier drill runs failed and are kept with their causes: a bug in the drill script, then an orderer that was
not ready after the restart, which led to `wait_for_orderer`.

**Restarting is not re-creating.** Use `./fabric/stop.sh` and `./fabric/start.sh` for routine restarts: they keep
the ledger. The closure regression of 2026-11-28 checked this: the ledger history of a shipment and the PostgreSQL
counts were identical before and after, and the Fabric integration tests passed afterwards
([evidence](evidence/gp1-closure-2026-11-28/regression/README.md)). `./fabric/up.sh` creates a new network and
deletes the old ledger, so since the GP1 closure it refuses when a network exists, unless you type `recreate` or
pass `--recreate`. `./fabric/down.sh` now asks first, like `reset.sh`. Take a backup before either.

## 4. After restoring an older ledger: PostgreSQL is ahead

If the ledger is restored from a backup, PostgreSQL may hold transactions that the ledger no longer has. The API
detects this when it starts. This was executed in the drill above:

* If the event checkpoint is at or above the ledger height, or its transaction is unknown to the ledger, the API
  moves the checkpoint back to the ledger's last block. It raises a **Critical "Ledger sync" alert** ("The ledger is
  behind the database") and writes `ledger.checkpoint_reset` to the audit log. `GET /api/admin/sync-status` shows
  the reset (`checkpointReset`).
* It changes nothing else. The reporting copy is not deleted, because it may be the only remaining trace of those
  transactions.

Then run the consistency check (Admin): `GET /api/admin/consistency`. It is read-only. For every shipment it
compares PostgreSQL with the ledger: the state, and the transaction ids on each side (`missingOnLedger`,
`missingInDatabase`). It also checks records without a shipment and whether the checkpoint is ahead. In the drill it
reported exactly one problem: SHP-2026-0049, `not_found`, with its transaction missing on the ledger.

What to do with such a shipment is a business decision. The API does not resubmit old signed transactions, and it
does not delete the reporting copy. The options are:

* create the request again through the dashboard, so that it gets a new ledger transaction;
* or record the loss in the audit trail and mark the old row as superseded. No API action exists for this; it needs
  a database change by an administrator, taken after a PostgreSQL backup.

## 5. Revoking a Fabric identity

**Executed as a drill with a disposable identity.** No existing identity was revoked
([evidence](evidence/completion-2026-11-27/revocation-drill.txt)).

```bash
./fabric/revoke-identity.sh 1 <identity> keycompromise            # every certificate of a client identity of Org1
./fabric/revoke-identity.sh 1 --certificate <cert.pem> superseded  # one old certificate, e.g. after renewal
./fabric/revoke-identity.sh 1 <identity> --dry-run                 # checks only, changes nothing
```

The script asks for the identity name as confirmation. It then works in three steps:

1. The organization's CA registrar revokes the certificates and generates a CRL.
2. The CRL is written into the organization's MSP definition on the channel, in a configuration update signed by
   the organization admin. From then on peers refuse proposals signed with a revoked certificate.
3. A line is added to `fabric/identities/revocations.log`.

It refuses peer, orderer, admin and registrar identities, so it cannot lock an organization out of its own network.

`./fabric/revocation-drill.sh` repeats the drill:

1. It enrolls a new client identity and shows that it can query and submit.
2. It re-enrolls the identity and revokes only the first certificate: that certificate is refused, the second
   still works.
3. It revokes the whole identity: queries and transactions are refused.
4. It shows that `wethaq-app` and the organization admin are unaffected.

**If `wethaq-app` itself must be revoked**, for example after a leaked key:

1. Revoke it.
2. Move its folder out of `fabric/identities/orgN/`.
3. Enroll a new identity under a new name: `FABRIC_APP_USER=wethaq-app2 ./fabric/enroll-identities.sh`.
4. Set `FABRIC_APP_USER=wethaq-app2` for the API and restart it.

Until then the API cannot submit for that organization. Steps 2 to 4 were not executed.

**Renewal: executed.** `./fabric/renew-identities.sh` re-enrolls `wethaq-app` with a new certificate and keeps the
previous folder as `wethaq-app.<timestamp>`. The previous certificate stays valid until it expires, unless you revoke
it with `revoke-identity.sh … --certificate <old cert.pem> superseded`. That is recommended once the API runs with
the renewed identity. It is a change to the channel, so it is the operator's decision.

## 6. Failures and what happens

| Failure | What the system does | Operator action | Verified |
| --- | --- | --- | --- |
| PostgreSQL down | `/health/ready` 503. Writes answer 503 and nothing is submitted to the ledger. The API keeps running and reconnects | start PostgreSQL | real outage on Fabric ([evidence](evidence/postgres-outage-fabric-2026-11-27.txt)) |
| PostgreSQL lost after a ledger commit | answer 202 *pending*. When PostgreSQL returns, the event consumer applies the commit once | none | failure tests |
| API crash or restart mid-operation | operation rows are written before submission. The reconciler resolves unknown outcomes with `qscc` | none | failure tests, Fabric browser test |
| Orderer or a peer down | 502 or 503 with the reason. Unknown outcomes become *pending* and are reconciled | `./fabric/verify-network.sh`, restart the container | real outages (earlier evidence) |
| PostgreSQL data lost | restore the latest dump (section 2). The event consumer catches up from the ledger | restore, start the API | executed |
| Ledger data lost | restore the Fabric backup (section 3), then the consistency check (section 4) | restore, check, decide | executed |
| Identity key leaked | revoke (section 5), enroll a new identity | as described | drill executed |
| Identity expiring | `verify-network.sh` warns 30 days before expiry | `renew-identities.sh` | renewal executed |

## 7. Suggested schedule

These suggestions have not been tested in operation:

* PostgreSQL: a daily `pg_dump`, plus one before every migration. Keep 14 days.
* Fabric: `backup.sh` with a passphrase before every chaincode upgrade or channel change, and weekly. The network
  is stopped while the volumes are copied (the restore in the drill took 25 s).
* Store the archives off the machine, and test a restore into a new database or a scratch network every term.
