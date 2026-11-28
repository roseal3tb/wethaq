# WETHAQ: GP1 final sign-off

Date: 28 November 2026. Branch `gp1-closure`, from `main` at `3347560`. Prepared for the project owner. This is a
technical sign-off by the development work, not a university approval.

**Conclusion: READY WITH DOCUMENTED LIMITATIONS**, on one condition: the supervisor confirms the phase names (§3).
The GitHub workflows have run on this branch and passed (§5, §8). If the supervisor says this is the
final GP482 submission, the conclusion still holds, but cancellation and returns (B5) and the user evaluation (B9)
must be reported as planned items that were not done, not as deferred ones.

Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle Cloud during GP1.

## 1. Scope of this sign-off

It covers the repository `roseal3tb/wethaq` on branch `gp1-closure`: the dashboard, the API, PostgreSQL, the
Hyperledger Fabric network scripts and chaincode, the workflows and the documentation in `docs/gp482/`. It does not
cover the GP481 report, which was not changed, or the research results in `analysis/results/`, which were not
changed. Nothing was deployed, bought or activated.

## 2. What is being submitted

| Item | Value |
| --- | --- |
| Repository | `roseal3tb/wethaq` (public) |
| Branch | `gp1-closure` (pull request #19): four code commits and two documentation commits on top of `main` at `3347560` |
| Code commit tested by the final regression | `d0835da` (later commits change documentation and evidence only) |
| Public demonstration | <https://wethaqksu.vercel.app>, Demo Mode, unchanged, **not connected to any blockchain network** |
| Submission package | `wethaq-gp1-submission.zip` with `wethaq-gp1-submission.zip.sha256`, built with `git archive` from the branch (§17) |

## 3. Academic basis and phase names

No university requirements document, rubric or course specification was provided. The only reference used is the
GP481 report. It calls the phases GP481 (Release 1, Semester 1) and GP482 (Release 2, Semester 2), and lists the
backend, Fabric, cancellation and returns, and user evaluation as GP482 work. This repository calls the current
submission "GP1" and defers items to "GP2". The two readings and their consequences are set out in
[evidence/gp1-closure-2026-11-28/academic-requirements-verification.md](evidence/gp1-closure-2026-11-28/academic-requirements-verification.md) §1
and [REPORT_DISCREPANCIES.md](REPORT_DISCREPANCIES.md) §7. **The project owner must confirm which reading
applies.**

## 4. What this closure did

| Area | Change | Status |
| --- | --- | --- |
| Fabric installer | pinned commit, SHA-256 per archive, image digests; no unpinned upstream script | COMPLETE AND VERIFIED (local, GitHub x64 and arm64) |
| Network safety | `up.sh` and `down.sh` no longer delete an existing ledger without confirmation | COMPLETE AND VERIFIED |
| Accessibility | heading order fixed without any visual change; NFR2 test added | COMPLETE AND VERIFIED |
| arm64 workflow | peaks by phase, storage, extra load, optional 2 CPU / 12 GB limit | COMPLETE AND VERIFIED on GitHub arm64 |
| Evaluation materials | UAT and expert kit | prepared, not executed |
| Verification | GitHub runs read and recorded, fresh `fabric.yml`, final regression | COMPLETE AND VERIFIED |
| Documentation | blockers reassessed, every status document updated, new evidence folder | COMPLETE |

No technology was changed, no dependency was added, the visual identity is unchanged (30 screenshots compared), the
datasets and the forecasting results were not touched, and no test was weakened.

## 5. GitHub Actions verification

Read on GitHub on 28 November 2026 ([github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md)). Pull request
#17: quality checks #30 and browser QA #26 passed (the first quality-check run failed on a registry limit and was
fixed). Pull request #18: quality checks #31 and browser QA #27 passed. Unit 20, API 109 passed and 7 skipped,
chaincode 24, in each run. **No Node 20 deprecation annotation** in any of them. The actions run on the Node 24
actions runtime; that does not change the API's Node 22 or the chaincode's Node 20.

On this branch (pull request #19, commit 03666f0): quality checks #32 and browser QA #28 passed; Fabric integration
#3 (run 46174623807) passed with 7 of 7 and NFR 31 of 31; arm64 runs 46174686728 and 46174759675 passed
([github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md)).

## 6. Fabric x64 verification

Fabric integration (manual) #2, run 46169704428, `workflow_dispatch` on `main` at `3347560`, 28 November 2026 about
17:16 UTC, `ubuntu-latest` (x86_64). Success in 4 m 42 s, no annotations. Fabric integration tests 7 of 7. NFR
**31 of 31** (slowest average write 536 ms, p95 reads 127 ms, 20 of 20 concurrent requests in 0.31 s, 10 of 10
workflows). Fabric browser test passed. Artifact `wethaq-fabric-run`, 8.4 KB,
sha256:4573cfe3b1b07838f5367f38eb3b91c712f1da4156700ddd00ea100b2a00522b. This closes B1.

## 7. Fabric installation supply chain

Before this closure, `fabric/install.sh` ran Hyperledger's `install-fabric.sh` from the `main` branch, which already
defaulted to Fabric 2.5.16. It now installs Fabric 2.5.12 and CA 1.5.15 only from pinned sources, and stops if a
hash does not match (tested with a wrong hash: exit 1, nothing unpacked). Limitation: Hyperledger publishes no
checksum files, so the hashes are trust on first use. They were taken on 28 November 2026, and the binaries match
the ones tested since September
([fabric-install/](evidence/gp1-closure-2026-11-28/fabric-install/README.md)).

## 8. arm64 and Oracle resource feasibility

WETHAQ passed natively on a GitHub-hosted arm64 runner (run 46166121729, Neoverse-N2, 4 vCPU, 16 GB): every
container was `linux/arm64`, NFR 31 of 31, with no emulation. The memory figures from that run (about 330 MiB of
containers and about 185 MB for the API) are **one sample at rest after the tests, not peaks**, on GitHub hardware,
not Oracle hardware ([arm64-measurement-context.md](evidence/gp1-closure-2026-11-28/arm64-measurement-context.md)).
The workflow now records peaks and can run limited to 2 CPUs and 12 GB. **Run 46174759675 did so and passed
every check**, including 30 workflow runs and 50 concurrent requests: WETHAQ peaked at about 531 MiB and 58 % of one
core, and the 50-request burst took 0.69 s (72.8 tx/s). This is still a GitHub runner, not Oracle hardware, so it shows
that WETHAQ fits in that size, not how fast it will be on Oracle. The planned
Oracle configuration (VM.Standard.A1.Flex, 2 OCPU, 12 GB, Always Free) was re-checked against Oracle's pages on 28
November 2026. Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle
Cloud during GP1.

## 9. Deployment safety and persistence

Initial creation (`up.sh`) and routine restarts (`stop.sh`, `start.sh`) are now separate, and `up.sh` refuses to
replace an existing network without confirmation ([DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) §4). The final
regression stopped and started the network: the ledger history and the PostgreSQL counts were identical, and the
Fabric integration tests passed again. No destructive action was taken against any existing database or ledger
outside the disposable test network.

## 10. Accessibility

NFR2 in the GP481 report asks for keyboard navigation, visible focus, reduced motion and a table alternative for
the main chart. All four are implemented, and three are checked by tests (visible focus is styled but not asserted).
axe's heading-order finding was fixed with no visual change. axe still reports colour contrast below 4.5:1 on small
secondary text (lowest 2.12:1). Fixing it means changing the palette, which this closure was not allowed to do, so
it is documented (B8). This is an automated check. **It is not a claim of WCAG conformance**, and no screen-reader
or user test was done ([accessibility/](evidence/gp1-closure-2026-11-28/accessibility/README.md)).

## 11. Chaincode runtime

The chaincode image uses `node:20-bookworm-slim`. Node.js 20 is end of life (nodejs.org, re-checked 28 November
2026). The Fabric libraries it uses support Node 22, and the chaincode unit tests already run on Node 22 in CI.
It was **not migrated**: changing the runtime right before submission without a verified Fabric run is a high-risk
change. The migration plan and acceptance criteria are in [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md) (B16) and
[ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md) §4.5.

## 12. Academic requirements

All twelve functional requirements (FR1 to FR12) and all seven non-functional requirements (NFR1 to NFR7) of the
GP481 report are COMPLETE AND VERIFIED, with the qualifications recorded: NFR2 as in §10; NFR5 without an independent
review; NFR7 on test machines, against a 2,000 ms target that the NFR script sets, because the report gives no
number. §5.6, §5.7 and §6.6 items 1 to 3 and 6 are done, §6.6 item 4 is partly done, and §5.8, §5.9 (bundle), §6.6
items 5 and 7 are not done
([REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md),
[academic-requirements-verification.md](evidence/gp1-closure-2026-11-28/academic-requirements-verification.md)).

## 13. Blocker reassessment

| Status | Items |
| --- | --- |
| COMPLETE AND VERIFIED | B1, B4, B13, B14, B15, B17, B18, B19; B8 for the NFR2 criteria |
| IMPLEMENTED BUT NOT VERIFIED | B3 (live revocation), B12 (macOS, WSL 2) |
| PARTIALLY COMPLETE | B8 colour contrast |
| BLOCKED | B10 (independent security review); B11 in this sandbox only |
| DEFERRED TO GP2 | B2 (Oracle deployment), B5 (cancellation, return, partial receipt), B7 (bundle), B9 (UAT and expert evaluation), B16 (chaincode Node 22) |
| NOT APPLICABLE | B6 (no real data in scope) |

Every deferred item has its reason, academic justification, current status, required work, dependencies and
acceptance criteria in [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md) §3.

## 14. User acceptance testing and expert evaluation

**Prepared, not executed.** [UAT_AND_EXPERT_EVALUATION_KIT.md](UAT_AND_EXPERT_EVALUATION_KIT.md) holds the
participant script, ten tasks, the SUS questionnaire, an expert checklist and blank result sheets. No participant
or expert has used it. No feedback, score or opinion exists, and none is reported anywhere in the repository.

## 15. Security

The team's own review is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Changes in this closure: F13 (actions pinned by
SHA) verified on GitHub; F15 (NFR failures hidden) verified on x64 too; F16 (unpinned installer) fixed; F18 (a
network could be replaced by mistake) found and fixed. `npm audit` found 0 vulnerabilities in the production
dependencies of the dashboard, the API and the chaincode, and the secret scan found nothing in tracked files. The
remaining open or accepted findings (F5 to F12, F14, F17) are unchanged. There has been no independent review or
penetration test (B10).

## 16. Final regression and lint

At `d0835da` on Linux x86_64, 28 November 2026
([regression/](evidence/gp1-closure-2026-11-28/regression/README.md)): build and type checks pass; unit 20; chaincode
24; API 109 passed, 7 skipped; Demo Mode browser 58 passed, 2 skipped; live mode 9 of 9 (on the re-run, after
removing variables that the script had leaked into the test's API; nothing was changed in between); fresh Fabric
network; Fabric integration 7 of 7, twice; NFR 31 of 31; a wrong password makes the NFR script fail, as it must;
persistence across a restart confirmed; Fabric browser test passed. The API image build fails in this sandbox only,
because npm inside Docker cannot reach the registry here (B11); it built on GitHub. ESLint: 0 errors and 106
warnings (98 `no-explicit-any`, 5 `exhaustive-deps`, 3 `only-export-components`). They were reviewed and left as
they are, because fixing them right before submission risks behaviour changes for no functional gain. The
configuration was not loosened.

## 17. Submission package

`wethaq-gp1-submission.zip` is made with `git archive` from the final commit of `gp1-closure`, so it contains only
tracked files: no `node_modules`, `.env`, Fabric identities, keys, certificates, backups, test results or git
history. Its SHA-256 is in `wethaq-gp1-submission.zip.sha256` next to it. It was checked by listing its contents
for excluded paths, by the same secret scan, and by a clean-copy test: unzip into an empty folder, `npm ci`, build,
unit tests, `npm ci` and tests in `wethaq-api`, and chaincode tests. The results are reported with the package.

## 18. What the project owner must do

1. Done: `gp1-closure` pushed, pull request #19 opened, and the three manual runs passed on it.
2. Push the last documentation commit (it records those runs), check that the pull-request checks pass again, then
   merge pull request #19.
3. Ask the supervisor which reading of the phase names applies (§3), and whether the UAT kit can be used.
4. Optional, with explicit approval only: revoke the superseded live `wethaq-app` certificate (B3).
