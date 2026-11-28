# Wethaq: remaining blockers and open items

Status as of 28 November 2026 (GP1 closure), branch `gp1-closure`. All items were reassessed against the evidence in
[evidence/gp1-closure-2026-11-28/](evidence/gp1-closure-2026-11-28/README.md). Everything else in
[REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) is complete and verified. Because of the items below, the
project is **not** complete in every respect, and no completion percentage is given.

**Update, start of GP2 (28 November 2026, branch `gp2-start`).** B5, B7 and B16 were done and verified locally,
including an upgrade of a running Fabric network with 81 existing shipments from chaincode version 1 to version 2
on Node.js 22. The GitHub Fabric and arm64 workflows have not run on this branch yet. Evidence: [evidence/gp2-start-2026-11-28/](evidence/gp2-start-2026-11-28/README.md).

Status labels: COMPLETE AND VERIFIED, IMPLEMENTED BUT NOT VERIFIED, PARTIALLY COMPLETE, BLOCKED, DEFERRED TO GP2,
NOT APPLICABLE.

**Phase names (confirmed).** On 28 November 2026 the project owner confirmed that the phases are named **GP1** (this submission) and **GP2** (the next phase), and that no other names are needed. Every "DEFERRED TO GP2" below is work for
the next phase. See [evidence/gp1-closure-2026-11-28/academic-requirements-verification.md](evidence/gp1-closure-2026-11-28/academic-requirements-verification.md) §1.

## 1. Summary

| # | Item | Status |
| --- | --- | --- |
| B1 | `fabric.yml` on GitHub (x64) with all NFR checks passing | COMPLETE AND VERIFIED |
| B2 | Hosted deployment on Oracle Cloud | DEFERRED TO GP2 |
| B3 | Revoking the superseded live `wethaq-app` certificate | IMPLEMENTED BUT NOT VERIFIED on a live identity |
| B4 | Merge of `gp1-final-readiness` | COMPLETE AND VERIFIED |
| B5 | Cancellation, return and multi-step partial receipt | COMPLETE AND VERIFIED locally (GP2); GitHub runs pending; the lifecycle is a proposal for the supervisor |
| B6 | Importing a real parts catalogue and inventory | NOT APPLICABLE in GP1 |
| B7 | Splitting the 951 KB dashboard bundle | COMPLETE AND VERIFIED (GP2) |
| B8 | Accessibility (NFR2) | NFR2 criteria COMPLETE AND VERIFIED; colour contrast PARTIALLY COMPLETE (documented risk) |
| B9 | User acceptance testing and expert evaluation | DEFERRED TO GP2 (materials prepared, not executed) |
| B10 | Independent security review | BLOCKED |
| B11 | Building the chaincode image in this sandbox | BLOCKED here only |
| B12 | This branch on macOS and WSL 2 | IMPLEMENTED BUT NOT VERIFIED |
| B13 | Registry pull limits | COMPLETE AND VERIFIED (handled) |
| B14 | Native arm64 run | COMPLETE AND VERIFIED (GitHub-hosted runner) |
| B15 | GitHub Actions on the Node 24 runtime, PR checks | COMPLETE AND VERIFIED |
| B16 | Chaincode runtime on Node.js 20 (end of life) | COMPLETE AND VERIFIED locally (GP2); GitHub Fabric and arm64 runs pending |
| B17 | Fabric installer pinned and checksum-verified | COMPLETE AND VERIFIED (local x86_64, GitHub x64 and arm64) |
| B18 | Peak memory and CPU under a 2 CPU / 12 GB limit | COMPLETE AND VERIFIED on a GitHub arm64 runner (not Oracle hardware) |
| B19 | Accidental replacement of an existing network | COMPLETE AND VERIFIED |

## 2. Closed or verified in this closure

| # | Item | Evidence |
| --- | --- | --- |
| B1 | Fabric integration (manual) #2, run 46169704428 on `main` (3347560), 28 Nov 2026: 7 of 7 integration tests, NFR **31 of 31**, browser test on Fabric passed, 4 m 42 s, artifact sha256:4573cfe3… | [github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md) |
| B4 | merged as pull request #17 (`c9c445b`) | — |
| B13 | `.github/scripts/pull-image.sh` falls back between registries, stops at a 429, and logs in when secrets exist | pull-request checks #30 and #31 passed |
| B14 | run 46166121729: every step passed, NFR 31 of 31, every container `linux/arm64`, no emulation | [evidence/github-arm64-2026-11-28/](evidence/github-arm64-2026-11-28/README.md) |
| B15 | quality checks #30 and #31 and browser QA #26 and #27 read on GitHub: all passed, no Node 20 deprecation annotation. This concerns the actions' runtime only, not the API (Node 22) or the chaincode (Node 20) | [github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md) |
| B17 | `fabric/install.sh` no longer runs the unpinned upstream helper. fabric-samples is pinned to a commit, the 8 release archives to SHA-256s, the 6 images to digests. A clean install, a second run and a wrong-hash test were run | [fabric-install/](evidence/gp1-closure-2026-11-28/fabric-install/README.md) |
| B17 | `fabric.yml` run 46174623807 on `gp1-closure`: pinned samples, both archives verified, images from ghcr.io by digest, 7 of 7, NFR 31 of 31. arm64 runs 46174686728 and 46174759675: installer and every check passed | [github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md) |
| B18 | arm64 run 46174759675 with Docker and the API limited to 2 CPUs and 12 GB (no swap): every check passed, including 30 workflow runs and 50 concurrent requests; WETHAQ peaked at about 531 MiB and 58 % of one core. A GitHub runner, not Oracle hardware | [github-runs.md](evidence/gp1-closure-2026-11-28/github-runs.md) |
| B19 | `fabric/up.sh` refuses to replace an existing network unless the user types `recreate` or passes `--recreate`. `fabric/down.sh` now asks first (it calls `reset.sh`). Routine restarts use `start.sh` and `stop.sh`, which keep the ledger | regression `persistence.txt`; DEPLOYMENT_GUIDE.md §4 |

## 3. Deferred items, with what GP2 must do

### B2. Hosted deployment on Oracle Cloud: DEFERRED TO GP2

* **Reason.** Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle
  Cloud during GP1. No account, server, domain or paid resource was created.
* **Academic justification.** The GP481 report lists "full-scale deployment" as out of scope. A deployment needs an
  account and a budget decision that the supervisor must approve.
* **Current status.** Target checked against Oracle's documentation on 28 Nov 2026 (VM.Standard.A1.Flex, 2 OCPU,
  12 GB, Always Free). Native arm64 run passed. Single-server configuration checked locally.
* **Required work.** ORACLE_CLOUD_READINESS.md §7, steps 1 to 25.
* **Dependencies.** Supervisor approval; an Oracle account in the right home region; a domain. (The resource run, B18, is done.)
* **Acceptance criteria.** Smoke checks pass over HTTPS on the server; `fabric.yml`-equivalent checks pass there;
  only ports 22 (admin range), 80 and 443 open; off-instance backup and one restore drill done; evidence recorded.

### B5. Cancellation, return and multi-step partial receipt: COMPLETE AND VERIFIED locally (GP2)

* **Done in GP2.** Chaincode version 2 adds `Cancel` (Org1, from Requested or Dispatched), `ReceivePartial` (Org2,
  less than is still outstanding, to Partially Received) and `Return` (Org2, from Received, up to the received
  quantity). `Receive` also closes a Partially Received shipment; received quantities add up. The five rules and their
  priority are unchanged. The API has `POST /shipments/:id/cancel`, `/receive-partial` and `/return`; migration 006
  adds the states, record types and `returned_qty`. Inventory: a cancelled dispatch goes back to the origin, a return
  moves stock from the destination to the origin, and what is outstanding counts as in transit. The dashboard shows
  the actions in live mode only; demo mode is unchanged. Upgraded on a running network with
  `./fabric/upgrade-chaincode.sh 2.0`: the 81 existing shipments still verify and the sampled histories are
  byte-identical. Tests: chaincode 34, API 116, Fabric integration 9, live browser 10, NFR 31 of 31. Evidence: [evidence/gp2-start-2026-11-28/](evidence/gp2-start-2026-11-28/README.md).
* **Still open.** The lifecycle (who may cancel, up to which state; one return per shipment) is a proposal and should
  be agreed with the supervisor. The GitHub Fabric and arm64 workflows must run on the branch.

* **Reason.** It needs new chaincode functions and rules, a chaincode upgrade endorsed by both organizations, and new
  dashboard actions. That is a high-risk change to the agreed lifecycle right before submission.
* **Academic justification.** GP481 §6.6 lists it as future work (item 5).
* **Status before GP2.** PARTIALLY COMPLETE in behaviour: a short receipt is accepted, recorded on the ledger and
  raises a Discrepancy alert. No cancellation, no return, no second receipt for the rest.
* **Required work.** States `Cancelled` and `Returned`; transitions and rules (who may cancel, up to which state;
  return quantity ≤ received); `ReceiveRemainder` or a partial flag; chaincode version 2 and upgrade with
  `fabric/upgrade-chaincode.sh`; API routes; dashboard actions; inventory effects.
* **Dependencies.** Agreement on the lifecycle with the supervisor; B16 if done at the same time.
* **Acceptance criteria.** Chaincode tests with accepted and rejected cases for each new rule; Fabric integration
  tests for each new path; the NFR integrity checks still pass; the upgrade keeps all earlier ledger records.

### B7. Splitting the dashboard bundle: COMPLETE AND VERIFIED (GP2)

* **Done in GP2.** `vite.config.ts` puts third-party code in vendor chunks (charts, React, UI parts, icons). The
  largest chunk is 442 kB (117 kB gzipped); Vite no longer warns. The chunks load with the page, so behaviour and
  appearance are unchanged: the demo browser tests pass on the development server and on the production build
  (58 passed, 2 skipped). Evidence: [evidence/gp2-start-2026-11-28/](evidence/gp2-start-2026-11-28/README.md).

* **Reason.** A build change to the frontend. The brief rules out redesigning the frontend, and the warning does not
  affect correctness.
* **Academic justification.** GP481 §5.9 says the bundle should be split "in a later iteration".
* **Status before GP2.** 951 KB (274 KB gzipped); Vite reported a chunk over 500 kB.
* **Required work.** Lazy-load the page components with `React.lazy`, or `manualChunks` for the chart library.
* **Dependencies.** None.
* **Acceptance criteria.** No chunk over 500 kB; all demo, live and Fabric browser tests pass; screenshots
  unchanged.

### B9. User acceptance testing and expert evaluation: DEFERRED TO GP2

* **Reason.** It needs participants, their consent, and a plan agreed with the supervisor. No results may be
  invented.
* **Academic justification.** GP481 §5.8: the plan "will be agreed with the supervisor before it is run, and its
  results will be reported in the next release".
* **Current status.** Materials prepared, not executed:
  [UAT_AND_EXPERT_EVALUATION_KIT.md](UAT_AND_EXPERT_EVALUATION_KIT.md) (tasks T1 to T10, SUS questionnaire, expert
  checklist, blank result sheets).
* **Required work.** Supervisor approves the kit; recruit 5 or more non-military volunteers; run the sessions; fill
  the sheets; report the results.
* **Dependencies.** Supervisor; participants; any ethics or consent rule of the university.
* **Acceptance criteria.** As proposed in the kit: completed sheets for every participant, task completion and SUS
  reported as measured, whether or not they reach the proposed targets (80 % task completion, SUS 68).

### B16. Chaincode runtime on Node.js 20: COMPLETE AND VERIFIED locally (GP2)

* **Done in GP2.** The chaincode image and the workflows' fallbacks use `node:22-bookworm-slim` (the same image and
  digest as the API), and the chaincode tests in the quality checks run on Node 22. The local network was upgraded
  to chaincode version 2.0 (sequence 2) on Node 22.23.5; the earlier ledger history still verifies (81 of 81).
  The local image was built from host-installed dependencies because of B11; CI builds it with the Dockerfile.
  Still to do: run `fabric.yml` and the arm64 workflow on the branch. Evidence: [evidence/gp2-start-2026-11-28/](evidence/gp2-start-2026-11-28/README.md).

* **Reason.** Node.js 20 is end of life (nodejs.org, checked 28 Nov 2026; Node 22 and 24 are LTS). Changing the
  chaincode runtime without a verified Fabric run right before submission is a high-risk change.
* **Academic justification.** Not in the GP481 report; a maintenance item.
* **Status before GP2.** The chaincode image used `node:20-bookworm-slim`. Its libraries (fabric-shim and
  fabric-contract-api 2.5.8) support Node 22. The chaincode unit tests already run on Node 22 in CI.
* **Required work.** Try it first without a code change: set the repository variable `CHAINCODE_NODE_IMAGE`
  (arm64 workflow) or `WETHAQ_CHAINCODE_NODE_IMAGE` (quality checks) to `node:22-bookworm-slim`. If those pass,
  change the default `ARG NODE_IMAGE` in `chaincode/shipment/Dockerfile` and the fallbacks in the workflows, then
  upgrade the chaincode on both organizations with `fabric/upgrade-chaincode.sh`.
* **Dependencies.** None outside the repository.
* **Acceptance criteria.** Chaincode tests, `fabric.yml` and the arm64 workflow pass with the new image; the
  ledger history from before the upgrade still verifies.

## 4. Other open items

| # | Item | Status | What is missing and who can unblock it |
| --- | --- | --- | --- |
| B3 | Revoke the superseded live `wethaq-app` certificate | IMPLEMENTED BUT NOT VERIFIED on a live identity | changes the channel configuration of the existing network, so only with explicit approval. The same script was verified on a disposable identity. The owner runs `./fabric/revoke-identity.sh <1\|2> --certificate <old cert.pem> superseded` |
| B6 | Real parts catalogue and inventory | NOT APPLICABLE in GP1 | the project uses public (RAF) and synthetic (Dataset C) data by design; no real data was provided. `npm run bootstrap` creates an empty installation. An import tool is needed only if real data is supplied |
| B8 | Accessibility | NFR2's four criteria COMPLETE AND VERIFIED (visible focus styled, not tested); colour contrast PARTIALLY COMPLETE | axe still reports contrast below 4.5:1 (lowest 2.12:1 on the dark notification badge). Fixing it changes the palette, which the brief rules out. Heading order was fixed with no visual change. No manual screen-reader test. Not WCAG conformance ([accessibility/](evidence/gp1-closure-2026-11-28/accessibility/README.md)) |
| B10 | Independent security review or penetration test | BLOCKED | needs a reviewer outside the team. The team's own review is in SECURITY_AUDIT.md |
| B11 | Building the chaincode image in this sandbox | BLOCKED here only | npm inside Docker builds cannot reach the registry here. CI and the arm64 workflow build it |
| B12 | This branch on macOS and WSL 2 | IMPLEMENTED BUT NOT VERIFIED | everything ran on Linux. `install.sh` handles darwin-amd64 and darwin-arm64 with their own hashes, but was not run on a Mac in this closure |

## 5. Accepted limitations (not planned)

* One Fabric identity per organization, not per user (SECURITY_AUDIT.md F9).
* The single-host fabric-samples test network (one orderer, one peer per organization) is not a production network
  (F11).
* JWT in session storage, no multi-factor sign-in, an in-memory rate limit (F6 to F8).
* The ESLint packages are installed at pinned versions in CI (`--no-save`), not added to `package.json`. 106
  warnings remain, none are errors: 98 `no-explicit-any` (73 in API tests, 25 in API source), 5
  `react-hooks/exhaustive-deps` and 3 `react-refresh/only-export-components`. They were reviewed and left as they
  are, because changing types or hook dependencies right before submission risks behaviour changes for no
  functional gain (FINAL_TEST_REPORT.md).
