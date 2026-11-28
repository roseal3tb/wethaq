# GitHub Actions runs checked on 28 November 2026

These were read on 28 November 2026 between about 17:10 and 17:30 UTC, from the run pages on github.com in the project owner's signed-in browser. Nothing on these pages was changed. The only action taken was starting Fabric integration run #2 (below), which the project owner asked for.

## Pull requests #17 and #18

| Workflow | Run # | Run ID | Trigger | Commit | Result | Duration | What the page shows |
|---|---|---|---|---|---|---|---|
| Wethaq quality checks | 29 | 46157324467 | PR #17 opened | before 87251cf | failure | 39 s | PostgreSQL service image hit the registry's anonymous pull limit. Fixed by 87251cf. |
| Responsive browser QA | 25 | 46157324517 | PR #17 opened | before 87251cf | success | 3 m 1 s | |
| Wethaq quality checks | 30 | 46160426763 | PR #17 updated | 87251cf | success | 44 s | Unit 20/20, API 109 passed and 7 skipped, chaincode 24/24. 10 annotations, all ESLint warnings. No Node 20 deprecation annotation. |
| Responsive browser QA | 26 | 46160426709 | PR #17 updated | 87251cf | success | 2 m 44 s | One warning: "No files were found" at `test-results/` in the live job, because the live tests passed and kept no traces. Artifact `wethaq-responsive-qa`, 16.9 MB, sha256:85cfcf838e253daafcfafab0f80f81f1fae93913b1d0777fc365addb0a4545f7 |
| Oracle Cloud ARM64 Readiness | 1 | 46166121729 | manual, main | c9c445b | success | 5 m 26 s | Recorded in `../github-arm64-2026-11-28/` |
| Wethaq quality checks | 31 | 46167180595 | PR #18 opened | cf9e50d | success | 46 s | Same counts as #30. ESLint warnings only. |
| Responsive browser QA | 27 | 46167180576 | PR #18 opened | cf9e50d | success | 2 m 42 s | Same `test-results/` warning. Artifact 17.1 MB, sha256:505b482724a90aad6d37f63dc7a7182f917bba54e4da06728fd390fac1b56bfa |

**Node 20 deprecation warnings.** None of the runs above shows a "Node.js 20 actions are deprecated" annotation. The workflows use `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0 and `actions/upload-artifact` v7.0.2, pinned by commit. Those versions run on the Node 24 actions runtime. This only concerns the runtime that GitHub Actions uses for the actions themselves. It does not change the Node version of the API (Node 22) or of the chaincode container (`node:20-bookworm-slim`, see `ORACLE_CLOUD_READINESS.md` §4.5).

## Fresh Fabric x64 verification: Fabric integration (manual) #2

| Field | Value |
|---|---|
| Run | https://github.com/roseal3tb/wethaq/actions/runs/46169704428 (job 141055114705) |
| Trigger | `workflow_dispatch`, branch `main` |
| Commit | 3347560 (merge of PR #18) |
| Date | 28 November 2026, started about 17:16 UTC |
| Runner | `ubuntu-latest` (x86_64, GitHub-hosted) |
| Result | success, 4 m 42 s in total (job 4 m 38 s), no annotations |
| Fabric integration tests (Vitest) | 7 of 7 passed |
| NFR script | "31 of 31 checks passed", report `nfr-results/nfr-2026-11-28T17-21-24.md` |
| Artifact | `wethaq-fabric-run`, 8.4 KB, sha256:4573cfe3b1b07838f5367f38eb3b91c712f1da4156700ddd00ea100b2a00522b |

Step durations: install Fabric 27 s; start the network and verify it 57 s; seed 7 s; start the API 3 s; integration tests 3 s; NFR 1 m 32 s (including a 65 s pause so the sign-in rate limit resets); browser test on Fabric 46 s.

NFR figures from the step log:

- Slowest average ledger write, one at a time: 536 ms
- Slowest p95 for reads and sign-in: 127 ms
- 20 concurrent shipment requests: 20 of 20 committed in 0.31 s (65.4 transactions per second)
- 10 full workflow runs: 10 of 10, no errors
- Integrity: a second receipt was refused by the chaincode (block 71), and a database tamper was detected (database 4, ledger 5)

The earlier run, Fabric integration #1 (run 46073086507, 3 m 53 s), passed 7/7 and 30 of 31 NFR checks. The one failure was fixed before PR #17. Run #2 is the first run on `main` with all 31 checks passing.

## Runs on branch `gp1-closure` (commit 03666f0), 28 November 2026

The project owner pushed the branch and opened pull request #19. At her request, Claude started the three manual runs from her signed-in browser at about 18:13 UTC, and read the results from the run pages at about 18:30 UTC.

| Workflow | Run # | Run ID | Result | Duration | What the page shows |
|---|---|---|---|---|---|
| Wethaq quality checks | 32 | (PR #19) | success | 48 s | pull-request checks |
| Responsive browser QA | 28 | (PR #19) | success | 2 m 50 s | pull-request checks |
| Fabric integration (manual), x64 | 3 | 46174623807 (job 141070429255) | success | 4 m 52 s | see below |
| Oracle Cloud ARM64 Readiness, no limit | 2 | 46174686728 | success | 8 m 3 s (job 7 m 58 s) | see below |
| Oracle Cloud ARM64 Readiness, `a1_limits` ticked | 3 | 46174759675 | success | 15 m 2 s including the wait for #2 (job 7 m 45 s) | see below |

**Fabric #3 (x64).** The pinned installer's step log shows fabric-samples cloned at `5789681b4f4d`, both linux-amd64 archives "SHA-256 verified" with the pinned hashes, and all six images pulled from `ghcr.io/hyperledger` by digest. That tests the ghcr.io path, which was blocked on the local test machine. Fabric integration tests 7 of 7. NFR "31 of 31 checks passed" (slowest average write 541 ms, slowest p95 read 120 ms, 20 of 20 concurrent requests in 0.32 s, 10 of 10 workflows, second receipt refused at block 71). The Fabric browser test step passed. Artifact `wethaq-fabric-run`, 8.41 KB, sha256:21dcaa804b177bcec79e5fb1212e9ae5b4c39475b13edbb99f2303c713b885a4.

**arm64 #2 and #3.** Both ran on `ubuntu24-arm64` (Neoverse-N2, 4 vCPU, 15,941 MiB). In both, the installer step and the network start passed, all running containers were `linux/arm64`, Fabric integration was 7 of 7, NFR was 31 of 31, the extra load step (30 runs, 50 concurrent) was also 31 of 31, and the Fabric browser test and the production API image passed. In #3, the job summary confirms the limit was in place before anything started: `CPUQuotaPerSecUSec=2s`, `MemoryMax=12884901888`, `MemorySwapMax=0`, `cpu.max` "200000 100000", and the Docker containers and the API inside `wethaq.slice`.

Resource figures (from each run's `resources-summary.md`, sampled every 2 s; MiB unless marked):

| Figure | #2, no limit | #3, 2 CPU / 12 GB |
|---|---|---|
| Containers' memory, sum: median / peak over the run | 287.1 / 337.6 | 281.1 / 326.5 |
| API resident memory: median / peak | 184.3 / 203.9 | 182.4 / 201.1 |
| Containers' CPU, sum: peak (100 % = one core) | 177.3 % (startup) | 61.0 % (startup) |
| Limited group (Docker + API): memory peak | — | 530.7 (includes the kernel's file cache for the group) |
| Limited group: CPU median / peak (200 % = the limit) | — | 1.4 % / 58.2 % |
| Host memory used, peak (whole runner, includes GitHub's own services) | 1,852 | 1,805 |
| Peak per container | peers 77.9 and 70.8, PostgreSQL 59.4, chaincode 45.8 and 45.5, orderer 29.0, CAs about 10 | peers 72.3 and 68.9, PostgreSQL 60.5, chaincode 45.8 and 45.3, orderer 29.9, CAs about 10 |

| Timings and throughput | #2, no limit | #3, 2 CPU / 12 GB |
|---|---|---|
| Install Fabric / start network | 33.0 s / 48.1 s | 30.9 s / 47.3 s |
| NFR: slowest average write, slowest p95 read | 537 ms, 88 ms | 538 ms, 86 ms |
| 20 concurrent requests | 20/20 in 0.29 s (68.8 tx/s) | 20/20 in 0.36 s (55.3 tx/s) |
| Extra load: 30 runs, slowest average write | 534 ms | 533 ms |
| Extra load: 50 concurrent requests | 50/50 in 0.54 s (93.2 tx/s) | 50/50 in 0.69 s (72.8 tx/s) |
| Storage after the runs: PostgreSQL data / orderer ledger / each peer ledger | 49 / 125 / 4 | 65 / 125 / 4 |

Artifacts: #2 `wethaq-arm64-readiness`, 38.4 KB, sha256:99a00c5eaf8063a9029f6869763ca28b26d39111bc6eefc96c2ce99d9226b36b. #3 `wethaq-arm64-readiness`, 39.4 KB, sha256:5bb2d9388f904cdca777ab6217ca8c2fe8d2cec1241314ea7a8ec7b511021a06. The artifacts themselves were not downloaded into this repository; the figures above are copied from the run summaries.

**What this shows.** Under a hard limit of 2 CPUs and 12 GB with no swap, every check passed, the whole of WETHAQ (Fabric, chaincode, PostgreSQL and the API) peaked at about 531 MiB of memory and about 58 % of one core, and the burst figures were lower than without the limit (55 to 73 tx/s instead of 69 to 93), with single writes unchanged at about 0.53 s because they wait for the orderer's 500 ms batch timeout. **What it does not show:** this is still a GitHub runner (Neoverse-N2), not an Oracle Ampere A1 instance (Neoverse-N1), with different disks and network. The load was at most 50 concurrent requests. It does not predict Oracle timings or capacity for real use.
