# WETHAQ native arm64 readiness run

```
date (UTC): 2026-11-28T16:37:17Z
workflow run: https://github.com/roseal3tb/wethaq/actions/runs/46166121729 (attempt 1)
commit: c9c445b5474d8da00f5ac75e8d3d0e81b1cc840c  ref: main
runner: GitHub Actions 1000000354  os: Linux  arch: ARM64  image: ubuntu24-arm64 20261122.193.1
uname -m: aarch64
uname -a: Linux runnervmu7lcj 7.0.0-1020-azure #21~24.04.2-Ubuntu SMP PREEMPT Tue Nov 10 01:19:17 UTC 2026 aarch64 aarch64 aarch64 GNU/Linux

PRETTY_NAME="Ubuntu 24.04.5 LTS"
VERSION_ID="24.04"

Architecture:                            aarch64
CPU(s):                                  4
Vendor ID:                               ARM
Model name:                              Neoverse-N2
Thread(s) per core:                      1
Core(s) per socket:                      4
Socket(s):                               1
nproc: 4

               total        used        free      shared  buff/cache   available
Mem:           15941        1128       13815          42        1270       14812
Swap:           3071           0        3071

Filesystem      Size  Used Avail Use% Mounted on
/dev/root       145G   39G  106G  27% /
/dev/root       145G   39G  106G  27% /

docker client 28.0.4 (arm64), server 28.0.4 (arm64)
docker info: aarch64 linux Ubuntu 24.04.5 LTS
docker compose: 2.38.2

binfmt_misc handlers registered:
llvm-16-runtime.binfmt
llvm-17-runtime.binfmt
llvm-18-runtime.binfmt
python3.12
register
status
node v22.23.5 arm64, npm 10.9.9
```

## Timings (seconds, exit code)

| Step | Seconds | Exit |
|---|---|---|
| npm install (dashboard) | 4.8 | 0 |
| npm ci (API) | 10.5 | 0 |
| PostgreSQL ready | 2.1 | 0 |
| build API image (linux/arm64) | 3.8 | 0 |
| install Fabric 2.5.12 / CA 1.5.15 | 27.2 | 0 |
| start Fabric network (fabric/up.sh, includes chaincode image build and verify-network) | 48.2 | 0 |
| migrate and seed through the ledger | 7.6 | 0 |
| API ready (Fabric mode) | 1.0 | 0 |
| Fabric integration tests | 3.5 | 0 |
| non-functional checks | 27.0 | 0 |
| Fabric browser test (Playwright, Chromium arm64) | 31.0 | 0 |
| API image ready (migrations included) | 2.0 | 0 |

## Image manifests

| Image | Reference | Digest | linux/arm64 | Platforms |
|---|---|---|---|---|
| fabric-peer 2.5.12 | hyperledger/fabric-peer:2.5.12 | `sha256:18f7503cfc82f062708f93199d372e3f63b6a1b8ce168f20f387d2ce87aaf2eb` | yes | linux/amd64 linux/arm64  |
| fabric-orderer 2.5.12 | hyperledger/fabric-orderer:2.5.12 | `sha256:d33a2714b6628d38a46b2e054d558e002cf2ee991828189741b3417c54e1ac0c` | yes | linux/amd64 linux/arm64  |
| fabric-ccenv 2.5.12 | hyperledger/fabric-ccenv:2.5.12 | `sha256:14c6cca8d85535d4eb08de66be025d20e953e7deff34e1c90c3e4f4cae7d497f` | yes | linux/amd64 linux/arm64  |
| fabric-baseos 2.5.12 | hyperledger/fabric-baseos:2.5.12 | `sha256:9133efd86ef1ad7e7f7f8e9795d0e23287aab4caf6b1d7500cccfde9870940fd` | yes | linux/amd64 linux/arm64  |
| fabric-tools 2.5.12 | hyperledger/fabric-tools:2.5.12 | `sha256:c802f0bae7998bfac4371c02b1cb794216b746931f127ba6dfe3d336ba5e0238` | yes | linux/amd64 linux/arm64  |
| fabric-ca 1.5.15 | hyperledger/fabric-ca:1.5.15 | `sha256:1b64dc702bd400e14c8f452dedc0359b7dc06679b751b08937eb2bf2865fed40` | yes | linux/amd64 linux/arm64  |
| node 22 (API) | node:22-bookworm-slim | `sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb` | yes | linux/amd64 linux/arm/v7 linux/arm64/v8 linux/ppc64le  |
| node 20 (chaincode) | node:20-bookworm-slim | `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0` | yes | linux/amd64 linux/arm/v7 linux/arm64/v8 linux/ppc64le linux/s390x  |
| postgres 16 | postgres:16-alpine | `sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d` | yes | linux/386 linux/amd64 linux/arm/v6 linux/arm/v7 linux/arm64/v8 linux/ppc64le linux/riscv64 linux/s390x  |
| caddy 2 (web server) | caddy:2 | `sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b` | yes | linux/amd64 linux/arm/v6 linux/arm/v7 linux/arm64/v8 linux/ppc64le linux/riscv64 linux/s390x windows/amd64  |

## Running containers

```
peer0org2_wethaq_ccaas	wethaq_ccaas_image:latest	linux/arm64
peer0org1_wethaq_ccaas	wethaq_ccaas_image:latest	linux/arm64
peer0.org2.example.com	hyperledger/fabric-peer:latest	linux/arm64
orderer.example.com	hyperledger/fabric-orderer:latest	linux/arm64
peer0.org1.example.com	hyperledger/fabric-peer:latest	linux/arm64
ca_orderer	hyperledger/fabric-ca:latest	linux/arm64
ca_org2	hyperledger/fabric-ca:latest	linux/arm64
ca_org1	hyperledger/fabric-ca:latest	linux/arm64
wethaq-pg	postgres:16-alpine	linux/arm64
```

## Health endpoint latency

```
/api/health/live: n=20 mean=0.0008 p50=0.0008 p95=0.0010 max=0.0013 s
/api/health/ready: n=20 mean=0.0079 p50=0.0079 p95=0.0082 max=0.0085 s
```

## Non-functional checks

Result: 31 of 31 checks passed.
| Action | Runs | Average | Median | 95th percentile | Max |
| Sign in | 4 | 82 ms | 79 ms | 89 ms | 89 ms |
| Create request (Planner, ledger) | 10 | 540 ms | 538 ms | 555 ms | 555 ms |
| Dispatch (Dispatcher, ledger) | 10 | 536 ms | 536 ms | 541 ms | 541 ms |
| Mark in transit (Dispatcher, ledger) | 10 | 533 ms | 534 ms | 535 ms | 535 ms |
| Confirm receipt (Receiver, ledger) | 10 | 537 ms | 535 ms | 551 ms | 551 ms |
| Verify against ledger | 10 | 18 ms | 17 ms | 21 ms | 21 ms |
| Load dashboard data (/state) | 10 | 13 ms | 11 ms | 30 ms | 30 ms |
| Create request, 20 at once | 20 | 276 ms | 274 ms | 289 ms | 289 ms |
| Quality attribute | Test | Expected | Observed | Result |
| Performance | Average time of each ledger write (one at a time) | < 2000 ms | slowest average 540 ms | Pass |
| Performance | Reads and sign-in (95th percentile) | < 2000 ms | slowest 89 ms | Pass |
| Performance | 20 concurrent shipment requests | all committed | 20/20 committed in 0.29 s (68.7 tx/s) | Pass |
| Reliability | Workflow runs without errors (10 × request, dispatch, transit, receipt) | 0 errors | 0 errors, 10/10 completed | Pass |
| Security | Data without signing in | 401 | 401 | Pass |
| Security | Forged token | 401 | 401 | Pass |
| Security | Admin token signed with another key | 401 | 401 | Pass |
| Security | Expired token | 401 | 401 | Pass |
| Security | Wrong password and unknown email give the same answer | 401, same message | 401 / 401, same message | Pass |
| Security | SQL injection in the sign-in form | 400 or 401 | 401 | Pass |
| Security | Planner adds a user | 403 | 403 | Pass |
| Security | Dispatcher creates a shipment request | 403 | 403 | Pass |
| Security | Receiver resets a password | 403 | 403 | Pass |
| Security | Dispatcher changes a role | 403 | 403 | Pass |
| Security | Planner records a dispatch (refused before the ledger) | 422, not submitted | 422, application, not submitted | Pass |
| Security | Receiver records a dispatch (refused before the ledger) | 422, not submitted | 422, application, not submitted | Pass |
| Security | Dispatcher confirms a receipt (refused before the ledger) | 422, not submitted | 422, application, not submitted | Pass |
| Security | A non-admin sees only their own user record | 1 user | 1 user(s) | Pass |
| Security | Password hashes are never returned by the API | not present | not present | Pass |
| Security | Passwords stored as bcrypt hashes | all users | 8/8 | Pass |
| Security | Security headers (helmet) | 4 headers | 4: x-content-type-options, content-security-policy, strict-transport-security, x-frame-options | Pass |
| Integrity | Completed shipments match the ledger | 10/10 | 10/10 | Pass |
| Integrity | A change made directly in PostgreSQL is detected | mismatch reported | detected: Received quantity: database 4, ledger 5 | Pass |
| Integrity | A second receipt is refused by the smart contract | noDuplicate | 422, noDuplicate (chaincode, block 71) | Pass |
| Integrity | Earlier ledger records are unchanged; the attempt is appended | unchanged, +1 record | unchanged, +1 record | Pass |
| Integrity | The shipment state is unchanged after the rejected attempt | unchanged | unchanged | Pass |
| Reliability | Rule noDuplicate: Duplicate receipt | rejected by noDuplicate | rejected by noDuplicate (chaincode) | Pass |
| Reliability | Rule authorizedOrg: Unauthorized organization | rejected by authorizedOrg | rejected by authorizedOrg (chaincode) | Pass |
| Reliability | Rule validTransition: Invalid status transition | rejected by validTransition | rejected by validTransition (chaincode) | Pass |
| Reliability | Rule validQuantity: Quantity exceeds dispatched | rejected by validQuantity | rejected by validQuantity (chaincode) | Pass |
| Reliability | Rule validReference: Unknown shipment reference | rejected by validReference | rejected by validReference (chaincode) | Pass |
