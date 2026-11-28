# GitHub Actions: Oracle Cloud ARM64 Readiness, 2026-11-28

The artifact `wethaq-arm64-readiness.zip` of the first run of `.github/workflows/oracle-arm64-readiness.yml`, downloaded
by the project owner and supplied on 2026-11-28. Files are copied unchanged. This was a **test on a GitHub-hosted
Arm runner**: everything was started for the length of the job and removed at the end. It is not a cloud
deployment, and WETHAQ has not been deployed to Oracle Cloud during GP1.

| Item | Value |
| --- | --- |
| File received | `wethaq-arm64-readiness.zip`, 13 files, 63,889 bytes uncompressed |
| SHA-256 of the file received | `fc05bda1e9e1532fbd4ba8d0815b532eb454988cb6a4ee02d03539f80da2e28f` |
| Integrity and secret scan | `unzip -t` clean; no private keys or tokens (the workflow also redacts them before upload) |
| Run | <https://github.com/roseal3tb/wethaq/actions/runs/46166121729>, attempt 1, started 2026-11-28T16:37:17Z (from `runner.txt`) |
| Commit | `c9c445b` on `main` (the merge of pull request #17) |
| Runner | GitHub `ubuntu-24.04-arm`, image ubuntu24-arm64 20261122.193.1, Ubuntu 24.04.5, kernel aarch64, Arm Neoverse-N2, 4 vCPU, 16 GB |

## What it shows

* **Native arm64, no emulation.** `uname -m`, Docker (server arch arm64) and Node.js (`process.arch`) all report
  arm64. No x86 emulator is registered in `binfmt_misc` (only `llvm-*-runtime` and `python3.12` handlers).
  Every running container's image is `linux/arm64`: the two peers, the orderer, the three Fabric CAs, both
  chaincode containers (built natively) and PostgreSQL (`containers.tsv`). The installed `peer` and
  `fabric-ca-client` are ARM aarch64 executables (`fabric-binaries.txt`).
* **Every step passed** (`timings.tsv`, exit code 0 each): dependencies, PostgreSQL, the API image build, Fabric
  install, network start with the chaincode build and `verify-network`, seed through the ledger, API start,
  Fabric integration tests, NFR, Fabric browser test (Chromium arm64), production API image start.
* **NFR: 31 of 31** (`nfr-results/nfr-2026-11-28T16-41-07.md`), including *SQL injection in the sign-in form* (401).
  This is the first GitHub run with the rate-limit wait and the exit-code fix. Ledger writes averaged
  533 to 540 ms, reads and sign-in at most 89 ms at the 95th percentile, 20 concurrent requests in 0.29 s
  (68.7 tx/s).
* **Resources** (`resources.txt`, one sample after the tests): peers 72 and 82 MiB, orderer 30 MiB, CAs about
  10 MiB each, chaincode containers about 30 MiB each, PostgreSQL 56 MiB, API (Fabric mode) about 136 MB
  resident. That is well under 1 GB in total. Health endpoints: `/live` 1.0 ms and `/ready` 8.2 ms at the
  95th percentile (`health-latency.txt`).
* **Production API image** (`wethaq-api:arm64`): applied all five migrations, answered ready, refused
  unauthenticated `/state` with 401, runs as `node`, `process.arch` arm64 (`api-image.log`). This check used the
  local development ledger on purpose; the Fabric path was tested with the API started from source.

## Limits

* The runner has 4 vCPU and 16 GB; the planned Always Free server has 2 OCPU and 12 GB. The run shows WETHAQ works
  natively on arm64 and how much memory it uses, not its timings on the smaller server.
* `install-fabric.sh` pulled the Fabric images from `ghcr.io/hyperledger` and tagged them as `hyperledger/*`; the
  manifest check in the same run read Docker Hub. Both serve arm64, and the running containers were checked
  directly.
* The image list in `resources.txt` also includes images that GitHub pre-loads on the runner (for example
  `ghcr.io/github/*`, `busybox`); they are not part of WETHAQ.
