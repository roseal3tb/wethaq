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

**Not yet run:** this workflow has not run on the `gp1-closure` branch. The installer change in that branch (5439dc4) was tested locally on x86_64 (see `fabric-install/`). The project owner needs to run `fabric.yml` and `oracle-arm64-readiness.yml` on the branch after pushing it.
