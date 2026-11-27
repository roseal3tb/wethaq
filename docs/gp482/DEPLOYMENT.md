# Wethaq — deployment and operations

This guide covers how the parts of Wethaq are deployed, how the dashboard reaches the API, and how to back up,
restore, roll back, troubleshoot and renew certificates. It describes an **academic prototype**: the Fabric network
is the fabric-samples test network on one machine, and nothing here makes the system production-ready or
security-certified. Nothing in this repository has been deployed to a hosted server; doing so needs the project
owner's explicit decision (and may cost money), so the hosted steps below are instructions, not a record of work done.

Each procedure says whether it was **executed** (with the evidence file) or is **documented only**.

## 1. Deployment architecture

```mermaid
flowchart LR
  subgraph Vercel["Vercel (wethaqksu.vercel.app) — deployed today"]
    Static["Dashboard build<br/>demo mode<br/>(VITE_WETHAQ_LIVE unset)"]
  end
  subgraph Host["One machine (developer laptop) — live mode"]
    Vite["Dashboard<br/>npm run dev:live :5173<br/>proxy /api → :4000"]
    API["wethaq-api :4000<br/>Node 22 · Express"]
    PG[("PostgreSQL 16<br/>Docker · 127.0.0.1:5434")]
    subgraph Docker["Docker network fabric_test"]
      Orderer["orderer.example.com :7050"]
      P1["peer0.org1 :7051"]
      P2["peer0.org2 :9051"]
      CC1["wethaq chaincode<br/>(CCAAS, Org1)"]
      CC2["wethaq chaincode<br/>(CCAAS, Org2)"]
      CA["Fabric CAs<br/>org1 :7054 · org2 :8054 · orderer :9054"]
    end
    IDs[["fabric/identities/<br/>wethaq-app per org<br/>(git-ignored, mode 600)"]]
  end
  Browser((Browser)) --> Static
  Browser --> Vite --> API
  API --> PG
  API -- "Fabric Gateway (gRPC/TLS)" --> P1
  API -- "Fabric Gateway (gRPC/TLS)" --> P2
  P1 --- CC1
  P2 --- CC2
  P1 --- Orderer
  P2 --- Orderer
  API -. signs with .-> IDs
  CA -. issued .-> IDs
```

| Part | Where it runs | Started by |
| --- | --- | --- |
| Dashboard, demo mode | Vercel, from `main` (automatic) | push to `main` |
| Dashboard, live mode | the developer machine | `npm run dev:live` (or `vite build` with `VITE_WETHAQ_LIVE=true`) |
| API | the developer machine, or the container in `wethaq-api/Dockerfile` | `npm run dev` / `npm start` in `wethaq-api`, or `docker compose --profile api up -d --build` |
| PostgreSQL | Docker container `wethaq-api-db`, volume `wethaq-api-pgdata` | `npm run db:up` in `wethaq-api` |
| Fabric | fabric-samples test network in Docker (2 orgs, 1 peer each, 1 Raft orderer, 3 CAs) | `./fabric/up.sh` (first time), `./fabric/start.sh` afterwards |

The Vercel deployment stays in demo mode: it has no API behind it and must not set `VITE_WETHAQ_LIVE`.

## 2. Connecting a dashboard to the API

The dashboard calls `/api/...` and reads live updates from `/api/events`.

**Same origin (default).** In development, Vite proxies `/api` to `http://127.0.0.1:4000` (`vite.config.ts`).
On a host, put a rewrite in front of the dashboard that forwards `/api/*` to the API. For a Vercel project this is
a rewrite placed **before** the catch-all rule in `vercel.json`, for example
`{ "source": "/api/:path*", "destination": "https://<api-host>/api/:path*" }`. Not applied in this repository:
the current Vercel project is the demo and has no API.

**Different origin.** Build the dashboard with `VITE_WETHAQ_LIVE=true` and `VITE_API_URL=https://<api-host>`
(no trailing `/api`), and start the API with `CORS_ORIGIN=https://<dashboard-host>`. The API then answers
cross-origin requests from that one origin only (`CORS_ORIGIN=*` is refused).

In either case the API needs HTTPS in front of it (a reverse proxy or the host's TLS termination): sign-in sends
passwords and the API returns bearer tokens.

## 3. Configuration

API (`wethaq-api/.env`, see `.env.example`; variables set in the shell win):

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | 4000 | |
| `DATABASE_URL` | `postgres://wethaq:wethaq@127.0.0.1:5434/wethaq` | the Docker PostgreSQL |
| `JWT_SECRET` | development value | required, ≥ 32 random characters, with `NODE_ENV=production` |
| `JWT_TTL` | 8h | session length |
| `NODE_ENV` | — | `production` turns off role switching, demo tools and `DEMO_PASSWORD` |
| `LEDGER_MODE` | local | `fabric` connects to the test network; it never falls back to `local` |
| `CORS_ORIGIN` | — | one dashboard origin when it is on another host |
| `DEMO_PASSWORD`, `DEMO_ROLE_SWITCH`, `DEMO_TOOLS` | demo / on / on | demonstrations only |
| `TEMP_PASSWORD_HOURS` | 24 | temporary passwords issued by an administrator |
| `RECONCILE_INTERVAL_MS`, `PENDING_EXPIRY_MS` | 30000, 300000 | ledger reconciliation |
| `FABRIC_TEST_NETWORK`, `FABRIC_IDENTITY_DIR`, `FABRIC_APP_USER`, `FABRIC_CHANNEL`, `FABRIC_CHAINCODE`, `FABRIC_ORG1_ENDPOINT`, `FABRIC_ORG2_ENDPOINT` | see `src/ledger/index.ts` | Fabric connection |
| `FABRIC_EVALUATE_TIMEOUT_MS`, `FABRIC_ENDORSE_TIMEOUT_MS`, `FABRIC_SUBMIT_TIMEOUT_MS`, `FABRIC_COMMIT_TIMEOUT_MS` | 5000, 15000, 5000, 60000 | gateway deadlines |
| `LOG_LEVEL` | info | JSON lines; secrets redacted |

Dashboard (build time): `VITE_WETHAQ_LIVE=true` for live mode; `VITE_API_URL` only for a different-origin API.

## 4. Start, stop and health

Order: Docker → Fabric → PostgreSQL → API → dashboard.

```bash
./fabric/start.sh            # or ./fabric/up.sh the first time
./fabric/verify-network.sh   # every line must say ok
cd wethaq-api && npm run db:up && npm run migrate && npm run dev
cd .. && npm run dev:live
```

Stop in the reverse order; `./fabric/stop.sh` keeps the ledger, `./fabric/reset.sh` deletes it (asks for confirmation).

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health/live` | the process answers (no dependencies checked) |
| `GET /api/health/ready` | 200 only when PostgreSQL and the ledger both answer; 503 otherwise, with the reason |
| `GET /api/admin/sync-status` (Admin) | event checkpoint, open ledger operations, last reconciliation |
| `GET /api/admin/audit` (Admin) | audit log |

## 5. Backup and restore

### PostgreSQL — executed

```bash
# backup (the API may keep running)
pg_dump --format=custom --no-owner "$DATABASE_URL" -f wethaq-$(date -u +%Y%m%dT%H%M%SZ).dump
# with the Docker database:  docker exec wethaq-api-db pg_dump -U wethaq -Fc wethaq > wethaq.dump

# restore into an empty database
createdb -O wethaq wethaq_restore            # or: docker exec wethaq-api-db createdb -U wethaq wethaq_restore
pg_restore --no-owner -d postgres://wethaq:wethaq@127.0.0.1:5434/wethaq_restore wethaq.dump
# point DATABASE_URL at it and start the API
```

After a restore the copy is older than the ledger. When the API starts, its event consumer reads the ledger from the
block stored in `event_checkpoints` and applies every transaction committed since the backup (applying is
idempotent). This was executed on the real network: a dispatch committed in block 44 after the backup was applied
to the restored copy when an API was started on it. Evidence: `evidence/backup-restore-renewal-2026-11-27.md`.

What PostgreSQL holds that the ledger does not: users and password hashes, inventory, alerts, audit log, review
notes. Those are only as recent as the last backup.

### Fabric ledger — documented only

The ledger lives in the Docker volumes of the test network (`docker volume ls | grep -E 'peer0|orderer'`). To copy it,
stop the network with `./fabric/stop.sh` and archive each volume, for example
`docker run --rm -v <volume>:/data -v "$PWD":/backup busybox tar czf /backup/<volume>.tgz -C /data .`, together with
`fabric/fabric-samples/test-network/organizations/` (the network's keys; keep this archive private). Restore by
extracting into the same volume names before `./fabric/start.sh`. Not exercised here. With two organizations each
holding a full copy of the ledger, a lost peer can also rejoin the channel and catch up from the other peer.

## 6. Rollback

| What | How | Notes |
| --- | --- | --- |
| Dashboard on Vercel | Vercel → Deployments → previous deployment → *Promote* / *Instant Rollback*, or `git revert` and push | demo mode, no data involved |
| API code | check out the previous commit and restart | |
| Database schema | migrations only move forward; roll back by restoring the backup taken before `npm run migrate` | take a dump before every migration |
| Chaincode | `./fabric/upgrade-chaincode.sh` with the previous source: Fabric needs a **new, higher** sequence even to go back, so "rollback" is an upgrade to old code | ledger data is not rolled back |
| Identities | the renewal script keeps the previous identity in `fabric/identities/orgN/wethaq-app.<timestamp>`; move it back and restart the API | |

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` | Docker Desktop not running | open Docker Desktop, wait until it says running |
| `ECONNREFUSED 127.0.0.1:5434` | PostgreSQL container not started | `npm run db:up` in `wethaq-api` |
| `npm error enoent … package.json` | command run outside the repository | `cd ~/Documents/GitHub/wethaq` first |
| `verify-network.sh`: chaincode does not answer | chaincode containers still starting, or CCAAS started without its id | re-run after 10 s; if it persists `./fabric/stop.sh && ./fabric/start.sh` |
| API: `LEDGER_MODE=fabric but the API could not connect` | network down or identities missing | `./fabric/verify-network.sh`; `./fabric/enroll-identities.sh` |
| `/health/ready` 503, `database: ok false` | PostgreSQL stopped | start it; the API reconnects by itself (no restart needed) |
| Operation answered 202 *pending* | the ledger did not confirm in time | nothing to do: the reconciler applies or fails it; see *Admin → sync status* |
| 502 *peers did not endorse* | a peer or chaincode container down | `./fabric/verify-network.sh`, then retry |
| 409 *invalidated by the peers* | two updates of the same shipment at once | retry |
| `Too many sign-in attempts` (429) | 10 sign-ins per minute per address | wait one minute |
| `Deadline is too far in the future` | an invalid `FABRIC_*_TIMEOUT_MS` | remove the variable or give milliseconds |
| Port 4000 / 5173 in use | an earlier process still running | stop it (`lsof -i :4000`) |

## 8. Certificates and identities

The API signs every transaction with an application identity per organization (`wethaq-app`, type client),
issued by that organization's Fabric CA and stored in `fabric/identities/` (git-ignored, files mode 600).
`verify-network.sh` warns when one expires within 30 days. These are service identities: the dashboard user is
recorded in the transaction and in the audit log, but there is no per-user cryptographic signature.

**Renewal — executed.** `./fabric/renew-identities.sh` (or `… 1` / `… 2` for one organization) re-enrolls the
identity with its CA, which issues a new certificate and key; the previous folder is kept as
`wethaq-app.<timestamp>` for rollback. Restart the API afterwards. Executed on 2026-11-27 for both organizations;
the API then committed block 44 with the renewed identities and the Fabric browser test passed with them.

**Revocation — documented only.** If a key may have leaked:

1. Revoke it at the CA with the registrar identity and generate a CRL:
   `FABRIC_CA_CLIENT_HOME=fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com fabric-ca-client revoke -e wethaq-app --gencrl --caname ca-org1 --tls.certfiles …/fabric-ca/org1/ca-cert.pem`
2. Peers only reject the certificate once the CRL is in the organization's MSP definition on the channel: fetch the
   channel configuration, add the CRL under `Org1MSP` → `revocation_list`, and submit the configuration update
   signed by the organization admins (`configtxlator` / `peer channel update`).
3. Enroll a new identity (`enroll-identities.sh` after removing the old folder, with a new identity name if the old
   one was revoked) and restart the API.

Not executed here: step 2 changes the channel configuration and was out of scope for the prototype.

**Network TLS and CA certificates** belong to the fabric-samples test network and are created by `./fabric/up.sh`;
they are re-created (with new keys) when the network is reset. They are not committed.
