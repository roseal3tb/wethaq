# Wethaq — deployment and operations

This guide covers how the parts of Wethaq are deployed, how the dashboard reaches the API, how to run everything on
one server, and how to roll back and troubleshoot. Backup, restore, certificate revocation and recovery are in
[BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md). It describes an **academic prototype**: the Fabric network is the
fabric-samples test network on one machine, and nothing here makes the system production-ready or
security-certified.

**Nothing in this repository has been deployed to a hosted server.** The single-server configuration in `deploy/`
was run and checked on the development machine only (section 9). Deploying it needs a server, a domain name and the
project owner's explicit decision, and may cost money.

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
| Everything on one server (prepared, not deployed) | `deploy/compose.yml`: PostgreSQL, API (Fabric mode), Caddy with HTTPS, next to the Fabric network | section 9 |

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
| `ANALYTICS_DIR` | `../analysis/results` | result files and `MANIFEST.json`; the API reports them as verified, modified, outdated or unverified |

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

Moved to [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md): PostgreSQL dump and restore (executed), Fabric network
backup and restore with `fabric/backup.sh` and `fabric/restore.sh` (executed), what to do when the ledger is older
than the database (executed), and a table of failures and recovery steps.

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

**Revocation — executed with a disposable identity.** `./fabric/revoke-identity.sh` revokes a client identity, or
one superseded certificate, and writes the CRL into the organization's MSP definition on the channel, so the peers
refuse it. The drill `./fabric/revocation-drill.sh` showed a revoked certificate refused and the others unaffected.
Details, and the steps after revoking `wethaq-app`, are in [BACKUP_AND_RECOVERY.md §5](BACKUP_AND_RECOVERY.md#5-revoking-a-fabric-identity).

**Network TLS and CA certificates** belong to the fabric-samples test network and are created by `./fabric/up.sh`;
they are re-created (with new keys) when the network is reset. They are not committed.

## 9. One server (prepared configuration, not deployed)

Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle Cloud during
GP1. The planned server (Oracle Cloud Always Free, Ampere A1 `VM.Standard.A1.Flex`, 2 OCPU, 12 GB, Ubuntu 24.04
aarch64), the arm64 audit and a step-by-step GP2 guide are in [ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md).

`deploy/compose.yml` runs PostgreSQL, the API in Fabric mode and a Caddy web server on one Linux machine, next to
the Fabric test network started by `./fabric/up.sh` on the same machine. Caddy serves the live-mode dashboard,
forwards `/api` to the API (server-sent events pass through unbuffered), obtains a certificate automatically for a
real domain name, and adds HSTS, a Content-Security-Policy and other security headers. Only Caddy publishes ports;
PostgreSQL and the API are reachable only on internal Docker networks, and the API container mounts only the two
peers' TLS CA certificates and its own identities (not the network's keys).

The Fabric peers and orderer are long-running stateful services; they belong on a server or virtual machine with
Docker and persistent disks, not on a serverless platform. The Vercel deployment stays the demonstration.

Requirements (what the check below used, not a sizing study): Linux x64 with Docker Engine and the Compose plugin,
Node 22 and npm (to build the dashboard and run the Fabric scripts), about 4 GB of memory, ports 80 and 443 open,
and a domain name pointing at the server for HTTPS.

```bash
# on the server, in a clone of the repository
./fabric/install.sh && ./fabric/up.sh            # Fabric test network, chaincode, identities
sudo chown -R 1000:1000 fabric/identities        # the API container runs as uid 1000 (files stay mode 600)
cp deploy/production.env.example deploy/production.env && chmod 600 deploy/production.env
#   fill in POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32) and WETHAQ_SITE_ADDRESS (the domain name)
npm ci && VITE_WETHAQ_LIVE=true npx vite build --outDir dist-live
docker compose -f deploy/compose.yml --env-file deploy/production.env up -d --build
docker compose -f deploy/compose.yml --env-file deploy/production.env exec api \
  node_modules/.bin/tsx src/cli/bootstrap.ts --admin-email <email> --admin-name "<name>"
#   prints a temporary password once; sign in at https://<domain> and replace it
```

`npm run bootstrap` (the command above, inside the container) creates the organizations, roles, storage locations
and one administrator, and nothing else: no demonstration accounts and no shipments. The administrator then creates
the other accounts. It refuses a database that already has users. `--demo-catalogue` also loads the synthetic parts
catalogue and baseline inventory of the demonstration, for trials only; a real installation needs its own parts and
inventory data, for which there is no import tool yet.

A new installation needs a **new channel or network**: shipment ids are numbered from the database, so a new database
on a channel that already holds shipments produces ids that already exist on the ledger, and the chaincode refuses
them (seen in the check below).

**Checked locally — executed, not a deployment.** On 2026-11-27 the stack ran on the development machine with scratch
secrets and plain HTTP on 127.0.0.1: bootstrap, first sign-in limited to the password change, an administrator
creating a Planner, a shipment committed on Fabric (block 6), live updates through Caddy, the consistency check,
sign-out, demonstration features refused in production, only Caddy published, the API running as uid 1000, and data
kept across a restart. The Content-Security-Policy was checked in a browser with no violations, and a negative
control showed the check detects them. Evidence: [single-vm-deploy-check.txt](evidence/completion-2026-11-27/single-vm-deploy-check.txt),
[bootstrap-cli.txt](evidence/completion-2026-11-27/bootstrap-cli.txt), [csp-check.txt](evidence/completion-2026-11-27/csp-check.txt).
Not checked: a real domain and certificate, a public network, and running for longer than a few minutes.

Base images can be pulled from a mirror when Docker Hub limits anonymous pulls: set `NODE_IMAGE`, `POSTGRES_IMAGE` and
`CADDY_IMAGE` in `deploy/production.env` (for example the `public.ecr.aws/docker/library/…` copies), or `docker login`.

## 10. Supported environments

| Environment | Status |
| --- | --- |
| Linux x64 (Ubuntu 24.04 container, Docker 29.9, Node 22.23) | every suite in [FINAL_TEST_REPORT.md](FINAL_TEST_REPORT.md) was run here |
| Linux x64, GitHub-hosted runner (`ubuntu-latest`) | the manual Fabric workflow ran on 2026-11-27: 7 of 7 integration tests (FINAL_TEST_REPORT.md) |
| Linux arm64 (GitHub `ubuntu-24.04-arm`, Arm Neoverse-N2) | the native workflow `oracle-arm64-readiness.yml` passed on 2026-11-28: Fabric, PostgreSQL, API, integration, NFR 31 of 31, browser test (ORACLE_CLOUD_READINESS.md §6). Not yet run on an Oracle Ampere A1 server (GP2) |
| macOS (Docker Desktop) | the first change set (`a53f392`) was run on the project owner's Mac: API tests, Fabric integration, NFR and `verify-network.sh`. The later changes have not been run on macOS |
| Windows with WSL2 | not tested. The scripts are bash and expect a Linux file system: clone the repository inside the WSL2 distribution (not under `/mnt/c`), and use Docker Desktop's WSL2 integration |

Setup on any of them: Docker running; `./fabric/install.sh` once; `./fabric/up.sh`; in `wethaq-api`: `npm install`,
`cp .env.example .env`, `npm run db:up && npm run migrate && npm run seed -- --reset` (with `LEDGER_MODE=fabric` in
`.env`), `npm run dev`; at the root: `npm install && npm run dev:live`. Environment variables are documented in
`wethaq-api/.env.example`, `.env.example` (dashboard) and `deploy/production.env.example`.
