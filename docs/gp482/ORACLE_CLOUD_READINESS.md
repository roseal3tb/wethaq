# Oracle Cloud ARM64 readiness (GP1)

**Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle Cloud during GP1.**

During GP1 no Oracle account was created, no instance was provisioned, no trial or Pay As You Go upgrade was
activated, and no domain or hosting was bought. This document records what was checked in GP1 so that a later
deployment to an Ampere A1 (Arm) server is predictable, and what is left for GP2. The public site
(wethaqksu.vercel.app) is unchanged: it runs the dashboard in Demo Mode, which is not connected to any blockchain
network.

Status labels follow the project's convention: COMPLETE AND VERIFIED, IMPLEMENTED BUT NOT VERIFIED,
PARTIALLY COMPLETE, BLOCKED, DEFERRED TO GP2, NOT APPLICABLE.

## 1. Summary

| Item | Status | Evidence |
| --- | --- | --- |
| Every container image used publishes `linux/arm64` (Fabric 2.5.12, Fabric CA 1.5.15, Node 22 and 20, PostgreSQL 16, Caddy 2) | COMPLETE AND VERIFIED | §4.1: manifest lists read from the registries on 2026-11-27 |
| Fabric 2.5.12 and Fabric CA 1.5.15 publish `linux-arm64` binaries, and the installer selects them on `aarch64` | COMPLETE AND VERIFIED | §4.2 |
| Installer pinned: fabric-samples commit, SHA-256 of every release archive, image digests | COMPLETE AND VERIFIED locally and on GitHub x64 and arm64 (2026-11-28) | §4.2; [fabric-install/](evidence/gp1-closure-2026-11-28/fabric-install/README.md) |
| No hard-coded `amd64`/`x86_64` in the project's scripts, Dockerfiles or compose files | COMPLETE AND VERIFIED | §4.3: search of `fabric/*.sh`, `deploy/`, both Dockerfiles, `.github/` |
| npm dependencies need no native build on arm64 | COMPLETE AND VERIFIED | §4.4: lockfile audit |
| Native arm64 run: build images, start Fabric, PostgreSQL and the API, integration and NFR checks, resource figures | COMPLETE AND VERIFIED on a GitHub-hosted arm64 runner (2026-11-28) | [evidence/github-arm64-2026-11-28/](evidence/github-arm64-2026-11-28/README.md): every step passed, NFR 31 of 31, all containers `linux/arm64`, no emulation |
| Proposed server size (VM.Standard.A1.Flex, 2 OCPU, 12 GB, Ubuntu 24.04 aarch64) fits Always Free | COMPLETE AND VERIFIED against the official documentation (re-read 2026-11-28) | §3 |
| Peak memory and CPU by phase, storage growth, and a run limited to 2 CPU / 12 GB | COMPLETE AND VERIFIED on a GitHub arm64 runner, not on Oracle hardware (runs 46174686728 and 46174759675) | §5, §6 |
| Oracle account, instance, network, DNS, TLS certificate, backups on OCI | DEFERRED TO GP2 | §7, §8 |

Compatibility of single dependencies is not taken as proof that WETHAQ runs on arm64: upstream Fabric states
that its Node chaincode images and libraries "are tested using amd64 (x86-64) only" (fabric-chaincode-node
`COMPATIBILITY.md`). WETHAQ's own arm64 behaviour is claimed only after the native workflow has passed.
No x86 emulation (QEMU) was used anywhere as a substitute.

## 2. What runs on the server

One Linux server running Docker, as described in `DEPLOYMENT_GUIDE.md` §9 and `deploy/compose.yml`:

* Hyperledger Fabric test network topology: one orderer, one peer per organization (Org1MSP, Org2MSP), three
  Fabric CA servers, and the `wethaq` chaincode as a service (one container per peer). Endorsement
  `AND(Org1MSP.peer, Org2MSP.peer)`.
* PostgreSQL 16 (off-chain records and the read model).
* The WETHAQ API (Node.js 22, Express, Fabric Gateway).
* Caddy 2 serving the dashboard build and proxying `/api` to the API, with TLS.

Only Caddy's ports 80 and 443 are meant to be reachable from the internet. PostgreSQL, the Fabric peers,
orderer and CAs, the API's port 4000 and the Docker socket stay on internal Docker networks or `127.0.0.1`.

## 3. Proposed configuration, checked against the official Oracle documentation

| Item | Proposed for GP2 | What the official documentation says (read 2026-11-27, re-read 2026-11-28) | Check |
| --- | --- | --- | --- |
| Shape | `VM.Standard.A1.Flex` (Ampere A1, Arm) | Always Free includes Arm instances on the `VM.Standard.A1.Flex` shape | Fits |
| CPU | 2 OCPU | Always Free Ampere A1: "2 OCPUs and 12 GB of memory" (1,500 OCPU hours and 9,000 GB hours per month), allocated flexibly to one or two instances | Fits, uses the whole A1 allowance in one instance |
| Memory | 12 GB | as above | Fits |
| Boot volume | 50 GB default; at most 100 GB planned | 200 GB of Block Volume in total (boot and block volumes combined) and five volume backups | Fits; leaves room for a separate backup volume |
| Image | Canonical Ubuntu 24.04 aarch64 (latest listed: `Canonical-Ubuntu-24.04-aarch64-2026.09.18-0`) | Oracle Linux and Ubuntu platform images are supported on Arm; Oracle recommends the Oracle Linux Cloud Developer image | Fits. Ubuntu matches the 24.04 runner used for the arm64 workflow |
| Region | the tenancy's home region | Always Free compute must be created in the home region; A1 is available in every availability domain except South Korea North (Chuncheon) | Choose the home region when the account is created; it cannot be changed later |
| Outbound traffic | small (dashboard and API) | 10 TB per month of outbound data included | Fits |

**Two official pages disagree on the A1 allowance.** The Always Free Resources page gives 2 OCPUs and 12 GB
(1,500 OCPU hours, 9,000 GB hours per month). The Arm-Based Compute page still gives 3,000 OCPU hours and
18,000 GB hours per month (4 OCPUs and 24 GB). The plan uses the smaller figure, so it fits either way. Check the
page again before provisioning in GP2. Both pages were re-read on 2026-11-28 and still disagree in the same way.

### Always Free conditions that affect WETHAQ

* **Idle reclamation.** Oracle may reclaim an Always Free instance that is idle over 7 days: CPU at the
  95th percentile below 20 %, network below 20 %, and (A1 only) memory below 20 %. A demonstration server with
  little traffic can meet all three. Plan for it in GP2: keep backups off the instance (§8, step 21), and do
  not rely on the instance surviving long idle periods. Do not add artificial load to dodge the rule.
* **Account inactivity.** Per the Free Tier FAQ, accounts left idle for 30 days or more may be treated as abandoned
  and suspended or terminated.
* **Exceeding the A1 allowance.** Per the FAQ, if A1 use goes above the Always Free limit when the trial ends,
  all A1 instances are disabled and deleted after 30 days unless the account is upgraded. Stay at 2 OCPU and
  12 GB in total.
* **Capacity.** "Out of host capacity" errors can last several days in the home region; try another
  availability domain in the home region, or wait.
* **Charges.** Always Free resources are not charged, and an upgraded account is charged only above the
  Always Free limits. Oracle does not recommend mixing paid and Always Free resources. Sign-up asks for a card
  for identity checks. **Decision for GP2:** stay on an Always Free-only account, do not upgrade to Pay As You Go
  without the supervisor's approval, and set a budget alert at 0 if the account is ever upgraded.
* **Trial end.** After the 30-day trial, trial-only resources are deleted; Always Free resources are kept.

## 4. ARM64 compatibility audit (done in GP1, without an Arm machine)

### 4.1 Container images

Manifest lists read with `docker buildx imagetools inspect` on 2026-11-27. Digests are the multi-platform index
digests at that time; tags can move, so GP2 should pin these digests (or newer ones that pass the workflow).

| Image | Index digest (2026-11-27) | linux/arm64 |
| --- | --- | --- |
| `hyperledger/fabric-peer:2.5.12` | `sha256:18f7503cfc82f062708f93199d372e3f63b6a1b8ce168f20f387d2ce87aaf2eb` | yes |
| `hyperledger/fabric-orderer:2.5.12` | `sha256:d33a2714b6628d38a46b2e054d558e002cf2ee991828189741b3417c54e1ac0c` | yes |
| `hyperledger/fabric-ccenv:2.5.12` | `sha256:14c6cca8d85535d4eb08de66be025d20e953e7deff34e1c90c3e4f4cae7d497f` | yes |
| `hyperledger/fabric-baseos:2.5.12` | `sha256:9133efd86ef1ad7e7f7f8e9795d0e23287aab4caf6b1d7500cccfde9870940fd` | yes |
| `hyperledger/fabric-tools:2.5.12` | `sha256:c802f0bae7998bfac4371c02b1cb794216b746931f127ba6dfe3d336ba5e0238` | yes |
| `hyperledger/fabric-ca:1.5.15` | `sha256:1b64dc702bd400e14c8f452dedc0359b7dc06679b751b08937eb2bf2865fed40` | yes |
| `node:22-bookworm-slim` (API) | `sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb` | yes (`arm64/v8`) |
| `node:20-bookworm-slim` (chaincode until GP2; now `node:22-bookworm-slim`, the API's image above) | `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0` | yes (`arm64/v8`) |
| `postgres:16-alpine` | `sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d` | yes (`arm64/v8`) |
| `caddy:2` | `sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b` | yes (`arm64/v8`) |

The library images were read through Google's Docker Hub mirror (`mirror.gcr.io`) because Docker Hub and
public.ecr.aws were rate-limiting this environment. The digests match Docker Hub's where both answered.

### 4.2 Fabric binaries and images

`fabric/install.sh` maps `uname -m` `aarch64` to `arm64` and downloads
`hyperledger-fabric-linux-arm64-2.5.12.tar.gz` and `hyperledger-fabric-ca-linux-arm64-1.5.15.tar.gz` from the
official GitHub releases. The workflow checks that the installed `peer` is an `ARM aarch64` executable.

**Pinned since commit 5439dc4 (GP1 closure).** Until then, `install.sh` downloaded Hyperledger's
`install-fabric.sh` from the `main` branch and ran it, so what it installed could change with no change in this
repository (on 2026-11-28 that script already defaulted to Fabric 2.5.16). Now the upstream helper is not run.
fabric-samples is checked out at commit `5789681b…`, each release archive (linux and darwin, amd64 and arm64) must
match a SHA-256 written in the script before it is unpacked, and the six images are pulled by their
multi-architecture index digests (ghcr.io first, Docker Hub second). Hyperledger publishes no checksum files for
these archives, so the hashes are trust on first use: they were taken on 2026-11-28 and the extracted binaries
match the ones tested since September. Details and the tamper test:
[evidence/gp1-closure-2026-11-28/fabric-install/](evidence/gp1-closure-2026-11-28/fabric-install/README.md).

### 4.3 Architecture assumptions in the project

No `amd64`, `x86_64` or `platform:` settings in `fabric/*.sh`, `deploy/`, `wethaq-api/Dockerfile`,
`chaincode/shipment/Dockerfile` or `.github/`. `fabric/fabric-samples` (with its x86-64 binaries in this
environment) is not committed; it is downloaded per machine, for that machine's architecture.

### 4.4 npm dependencies

From `wethaq-api/package-lock.json` and `chaincode/shipment/package-lock.json`:

* `bcryptjs`, `@grpc/grpc-js`, `pg`, `express`, `jsonwebtoken` are pure JavaScript.
* `esbuild` (used by `tsx` at run time) ships a prebuilt `@esbuild/linux-arm64` package.
* `protobufjs` has an install script that only checks versions (no native build).
* `pkcs11js` (optional, hardware security modules, pulled in by the Fabric Gateway) needs a native build. It is
  optional and WETHAQ does not use HSMs; if it cannot build, npm skips it, as on amd64.
* Build-only tools (rolldown, lightningcss) ship `linux-arm64-gnu` binaries.

### 4.5 Chaincode runtime: Node.js 20

**Update, start of GP2.** The chaincode now runs on `node:22-bookworm-slim` (REMAINING_BLOCKERS.md, B16). It was
verified locally by upgrading a running network to chaincode version 2.0; the arm64 workflow has not run on it yet.
The text below is the GP1 decision.

The chaincode image uses `node:20-bookworm-slim`. Node.js 20 is end-of-life (nodejs.org lists it as EOL;
22 and 24 are LTS). The chaincode uses `fabric-shim` and `fabric-contract-api` 2.5.8, which per
fabric-chaincode-node's compatibility table needs Node 18 or later and ships with a Node 22 runtime.

Node.js release status re-checked on nodejs.org on 2026-11-28: 20 is end of life, 22 and 24 are LTS.

**Decision:** not migrated in GP1. Changing the runtime right before submission without a verified run is
exactly what the brief forbids. **DEFERRED TO GP2:** move the chaincode image to Node 22, then run the chaincode
unit tests, `fabric.yml` and the arm64 workflow before accepting it. The API already runs on Node 22.
The GitHub Actions themselves now run on Node 24 (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0,
`actions/upload-artifact` v7.0.2); that is the runtime of the actions, not of WETHAQ.

**Migration plan for GP2.** (1) Set the repository variable `CHAINCODE_NODE_IMAGE` to `node:22-bookworm-slim` and
run the arm64 workflow, and `WETHAQ_CHAINCODE_NODE_IMAGE` for the quality checks; no code change is needed for this
trial. (2) If they pass, change the default `ARG NODE_IMAGE` in `chaincode/shipment/Dockerfile` and the fallbacks in
the workflows. (3) Upgrade the chaincode on both organizations with `fabric/upgrade-chaincode.sh` and check that the
earlier ledger history still verifies. The acceptance criteria are in REMAINING_BLOCKERS.md (B16).

## 5. Resource expectations

The figures below come from **this development environment (x86-64, 4 vCPU, 16 GB)** with the network,
PostgreSQL and the API idle after the tests, one `docker stats` sample on 2026-11-27. They are indicative only.
The arm64 figures will come from the workflow.

| Component | Memory (x86-64, idle) |
| --- | --- |
| 2 peers | about 48 MB each |
| Orderer | about 17 MB |
| 3 Fabric CAs | about 10 MB each |
| 2 chaincode containers | about 29 to 32 MB each |
| API (tsx and Node, Fabric mode) | about 130 MB resident |
| API production image (local ledger, after migrations) | about 139 MB |

On the **native arm64 runner** (2026-11-28, one sample after the tests): peers 72 and 82 MiB, orderer 30 MiB,
CAs about 10 MiB each, chaincode containers about 30 MiB each, PostgreSQL 56 MiB, API about 136 MB resident.

**What these numbers are.** Each is one sample taken after the tests had finished, so it is memory at rest, not
peak memory, and the runner is not Oracle hardware. The NFR timings are averages per operation type over 10
sequential workflow runs, and the 68.7 tx/s figure is a burst of 20 concurrent create-request transactions, not a
sustained rate. Most of the 0.5 s per write is the orderer's 500 ms `BatchTimeout`. The full explanation is in
[arm64-measurement-context.md](evidence/gp1-closure-2026-11-28/arm64-measurement-context.md).

At rest, that is well under 1 GB of the 12 GB planned. Peaks under load, with and without a 2 CPU / 12 GB limit,
are in §6. Disk is the larger item: the
Fabric images alone take several GB (`fabric-ccenv` about 1 GB, `fabric-tools` about 0.9 GB, chaincode image
about 0.7 GB in this environment), which is why §3 plans a 50 to 100 GB boot volume.

## 6. Native arm64 workflow

`.github/workflows/oracle-arm64-readiness.yml` ("Oracle Cloud ARM64 Readiness") runs manually on GitHub's
`ubuntu-24.04-arm` runner. GitHub documents arm64 Linux runners as free and generally available for public
repositories (4 vCPU, 16 GB RAM, 14 GB SSD); they do not work in private repositories.

It fails unless `uname -m`, Docker and Node.js all report arm64 and every running container image is
`linux/arm64`. It then builds the API and chaincode images natively, installs Fabric, starts the network,
PostgreSQL and the API, runs the Fabric integration tests, the NFR checks and the Fabric browser test, starts the
production API image, measures CPU, memory, disk, image sizes, step timings and endpoint latency, and uploads a
sanitized artifact `wethaq-arm64-readiness`. Everything is removed at the end. It uses a read-only token and
binds every port to `127.0.0.1`.

To run it: GitHub → Actions → "Oracle Cloud ARM64 Readiness" → Run workflow (on the branch that contains it).
Then download the artifact and add it under `docs/gp482/evidence/arm64-readiness-<date>/` with the run URL.
**First run, 2026-11-28:** <https://github.com/roseal3tb/wethaq/actions/runs/46166121729> on `main` (`c9c445b`),
Arm Neoverse-N2, 4 vCPU, 16 GB. Every step passed: native image builds, Fabric network with both peers and the
chaincode on arm64, Fabric integration tests, NFR 31 of 31, the Fabric browser test, and the production API image.
The whole stack used well under 1 GB of memory. Evidence:
[evidence/github-arm64-2026-11-28/](evidence/github-arm64-2026-11-28/README.md).

The runner is 4 vCPU and 16 GB; the planned server is 2 OCPU and 12 GB (an OCPU on Ampere A1 is one core). The
run shows that WETHAQ works on arm64 and how much memory it uses at rest. It does not prove the timings of the
smaller server.

**Peak and limited runs (added in the GP1 closure).** The workflow now samples every container, the
API, the host and (when limited) the cgroup every 2 seconds, marks the phases (startup, 30 s idle, NFR checks, an
extra load step of 30 workflow runs and 50 concurrent requests), and writes `resources-summary.md` (median and peak
per phase), `storage.txt` (PostgreSQL and ledger sizes) and `timings.tsv` (network start phases). Its
`a1_limits` input runs Docker and the API inside a systemd slice limited to `CPUQuota=200%`, `MemoryMax=12G` and no
swap, and checks that the limit is in place before it starts. To run it: Actions → "Oracle Cloud ARM64 Readiness"
→ Run workflow → branch `gp1-closure` → once with `a1_limits` unticked, once ticked. This is still a GitHub
runner (Neoverse-N2), not an Oracle A1 instance (Ampere Altra): it shows whether WETHAQ fits in 2 CPUs and 12 GB,
not the exact timings on Oracle.

**Results, 28 November 2026** ([github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md)). Run 46174686728
(no limit) and run 46174759675 (2 CPUs, 12 GB, no swap) both passed every check, including the extra load step.
Under the limit, Docker and the API together peaked at about 531 MiB (file cache included) and 58 % of one core;
containers peaked at about 327 MiB in total and the API at about 201 MiB. Single writes stayed at about 0.53 s;
the 50-request burst took 0.69 s (72.8 tx/s) against 0.54 s (93.2 tx/s) without the limit. After the runs, the
orderer ledger was 125 MiB, each peer ledger 4 MiB and PostgreSQL 49 to 65 MiB. So 12 GB leaves a wide margin for
memory; CPU is the resource the limit affects. Oracle timings still need a measurement on the instance in GP2.

## 7. Future GP2 deployment guide (not performed)

Placeholders: `<HOME_REGION>`, `<COMPARTMENT>`, `<VCN_NAME>`, `<SERVER_PUBLIC_IP>`, `<DOMAIN>`,
`<ADMIN_CIDR>` (the administrator's own address range), `<ADMIN_USER>`, `<SSH_PUBLIC_KEY_FILE>`,
`<BACKUP_BUCKET>`. No real values are recorded in the repository.

1. Get the supervisor's approval for the account, the region and the budget rule (Always Free only).
2. Create the Oracle Cloud account. Choose `<HOME_REGION>` with care: it cannot be changed, and Always Free
   compute must live there.
3. Do not upgrade to Pay As You Go. If it is ever upgraded, create a budget with an alert at 0 first.
4. Create the compartment `<COMPARTMENT>` and a non-root administrator with multi-factor authentication.
5. Create the VCN `<VCN_NAME>` with one public subnet and an internet gateway.
6. Network security: allow 22/tcp only from `<ADMIN_CIDR>`, and 80/tcp and 443/tcp from anywhere. Nothing else.
   PostgreSQL (5432), the API (4000), Fabric (7050, 7051, 9051, 7054, 8054, 9054, 9443-9445) and the Docker
   socket are never opened.
7. Launch `VM.Standard.A1.Flex` with 2 OCPU and 12 GB, the latest Canonical Ubuntu 24.04 aarch64 platform image,
   a 50 to 100 GB boot volume and `<SSH_PUBLIC_KEY_FILE>`. Confirm the console marks it Always Free-eligible.
8. Sign in as `<ADMIN_USER>` over SSH. Disable password sign-in and root SSH sign-in. Apply updates and turn on
   unattended security updates.
9. Configure the host firewall to the same rules as step 6.
10. Install Docker Engine and the Compose plugin from Docker's official repository for Ubuntu (arm64). Do not add
    untrusted users to the `docker` group.
11. Confirm `uname -m` is `aarch64` and `docker info` reports `aarch64`.
12. Clone the repository at the release tag that passed the arm64 workflow.
13. Run `./fabric/install.sh` (pinned, §4.2). Check that
    `fabric/fabric-samples/bin/peer` is `ARM aarch64`.
14. Start the network with `./fabric/up.sh` and check it with `./fabric/verify-network.sh`.
15. Build the API image natively: `docker build -f wethaq-api/Dockerfile -t wethaq-api .`.
16. Build the dashboard in live mode (`VITE_WETHAQ_LIVE=1`) and check the CSP hash with
    `node deploy/check-csp-hash.mjs`.
17. Copy `deploy/production.env.example` to `deploy/production.env`, set `chmod 600`, and fill it with new
    values (`JWT_SECRET` from `openssl rand -hex 32`, a strong database password, `<DOMAIN>`). Never commit it.
18. Point `<DOMAIN>` at `<SERVER_PUBLIC_IP>` (DNS A record) and wait until it resolves.
19. Start the stack: `docker compose -f deploy/compose.yml --env-file deploy/production.env up -d`. Caddy obtains
    the TLS certificate for `<DOMAIN>`.
20. Create the first administrator with `npm run bootstrap` inside the API container (no demonstration accounts in
    production), then sign in over HTTPS.
21. Backups: schedule `fabric/backup.sh` and a PostgreSQL dump (`BACKUP_AND_RECOVERY.md`), copy them off the
    instance to `<BACKUP_BUCKET>` (Always Free Object Storage, within 20 GB), and run one restore drill.
22. Monitoring: watch `/api/health/ready`, disk use and certificate expiry; record the Always Free idle rule
    (§3) and the 30-day account inactivity rule.
23. Run the smoke checks against `https://<DOMAIN>`: health, sign-in, create a shipment, verify it against the
    ledger, the CSP test in `e2e-deploy/`.
24. Record evidence (date, image digests, run outputs, without secrets) under `docs/gp482/evidence/`.
25. Only then update the README and the report to say WETHAQ is deployed, with the address and date. Keep the
    Vercel Demo Mode site as it is, labelled as a demonstration.

## 8. Deferred to GP2

| Item | Status |
| --- | --- |
| Oracle Cloud account, Always Free A1 instance, VCN and security rules | DEFERRED TO GP2 |
| Domain name, DNS and the public TLS certificate | DEFERRED TO GP2 |
| Production deployment of the Fabric network, API and dashboard on Oracle Cloud | DEFERRED TO GP2 |
| Off-instance backups to Object Storage and a restore drill on the server | DEFERRED TO GP2 |
| Monitoring and alerting on the server | DEFERRED TO GP2 |
| Chaincode runtime from Node.js 20 (EOL) to Node.js 22 | COMPLETE AND VERIFIED locally in GP2; the arm64 workflow still has to run (B16) |
| Pinning the Fabric installer and the image digests | COMPLETE AND VERIFIED in the GP1 closure, locally and on GitHub x64 and arm64 (§4.2) |
| Peak and 2 CPU / 12 GB measurements on the arm64 runner | COMPLETE AND VERIFIED on GitHub (§6); measure again on the Oracle instance in GP2 |
| Production identity management (CA administrator credentials off the server, revocation procedures on real identities) | DEFERRED TO GP2 |

## Sources (read 2026-11-27; the Oracle pages and nodejs.org re-read 2026-11-28)

* Oracle, Always Free Resources: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
* Oracle, Cloud Free Tier FAQ: <https://www.oracle.com/cloud/free/faq/>
* Oracle, Arm-Based Compute: <https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm>
* Oracle, All Ubuntu 24.04 Images: <https://docs.oracle.com/en-us/iaas/images/ubuntu-2404/index.htm>
* GitHub, GitHub-hosted runners reference: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
* GitHub Changelog, arm64 hosted runners for public repositories are generally available (2025-08-07):
  <https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/>
* Hyperledger, fabric-chaincode-node `COMPATIBILITY.md`: <https://github.com/hyperledger/fabric-chaincode-node/blob/main/COMPATIBILITY.md>
* Node.js, Previous releases (release status): <https://nodejs.org/en/about/previous-releases>
* Hyperledger, `install-fabric.sh` (no longer used, read for comparison): <https://github.com/hyperledger/fabric/blob/main/scripts/install-fabric.sh>
* Node.js, Previous releases: <https://nodejs.org/en/about/previous-releases>
