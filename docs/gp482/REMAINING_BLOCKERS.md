# Wethaq: remaining blockers and open items

As of 2026-11-27 (GP1 submission), branch `gp1-final-readiness`. Each item names what is missing, why it is not done, and who or what can
unblock it. Everything else in [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) is complete and verified.
Because of the items below, the project is **not** 100% complete.

## Needs the project owner's action or approval

| # | Item | Status | Why | What unblocks it |
| --- | --- | --- | --- | --- |
| B1 | GitHub Actions: the manual `fabric.yml` | Integration: COMPLETE AND VERIFIED. NFR fix: COMPLETE AND VERIFIED on GitHub through the arm64 workflow | `fabric.yml` ran on GitHub on 2026-11-27: 7 of 7 integration tests, but NFR 30 of 31 hidden by an exit code 0 (evidence/github-fabric-2026-11-27/). Fixed in pull request #17. The same NFR script and 65 s wait then gave **31 of 31** on GitHub in the arm64 run of 2026-11-28 (evidence/github-arm64-2026-11-28/). A new x64 `fabric.yml` run has not been supplied | optional: run *Fabric integration (manual)* on `main` again |
| B2 | Hosted deployment (API, PostgreSQL and Fabric on a server, dashboard in live mode) | DEFERRED TO GP2 | Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle Cloud during GP1. No account, server, domain or paid resource was created. The planned target (Oracle Cloud Always Free, Ampere A1, 2 OCPU, 12 GB) is checked against Oracle's documentation in [ORACLE_CLOUD_READINESS.md](ORACLE_CLOUD_READINESS.md) | GP2, with the supervisor's approval. `deploy/` and DEPLOYMENT_GUIDE.md §9 were checked locally |
| B3 | Revoking the superseded `wethaq-app` certificate after a renewal | IMPLEMENTED BUT NOT VERIFIED on a live identity | a change to the channel configuration of the existing network; only done with explicit approval. The same script was verified on a disposable identity | the owner runs `./fabric/revoke-identity.sh <1\|2> --certificate <old cert.pem> superseded` |
| B4 | Merge of `gp1-final-readiness` to `main` | COMPLETE AND VERIFIED | merged as pull request #17 (`c9c445b`) on 2026-11-28 | — |
| B14 | Native arm64 run (`oracle-arm64-readiness.yml`) | COMPLETE AND VERIFIED (GitHub-hosted arm64 runner) | run 46166121729 on 2026-11-28: every step passed, NFR 31 of 31, every container `linux/arm64`, no emulation (evidence/github-arm64-2026-11-28/). This is a test, not a deployment | — |
| B15 | GitHub Actions on Node 24 | COMPLETE AND VERIFIED that the new actions work; the warning's absence reported by the owner | `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0 and `actions/upload-artifact` v7.0.2 (pinned by SHA) ran in the arm64 run, which succeeded and uploaded its artifact. The project owner reported the pull-request #17 checks as passing; no screenshot or run link was recorded | — |

## Needs a scope decision

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B5 | Cancellation, return and multi-step partial-receipt workflows (GP481 §6.5 and §6.6.5) | PARTIALLY COMPLETE | a short receipt is accepted and raises a Discrepancy alert. Cancellation, returns and receiving the rest later are not implemented: they need new chaincode functions and rules (a chaincode upgrade on both organizations) and new dashboard actions. That changes the agreed lifecycle, so the owner should decide whether they belong in GP482 |
| B6 | Importing a real parts catalogue and inventory | NOT IMPLEMENTED | `npm run bootstrap` creates an installation without demonstration data, but there is no import tool, and no real data is available (the project uses public and synthetic data) |
| B7 | Splitting the 951 KB dashboard bundle (GP481 §5.9) | NOT IMPLEMENTED | a frontend build change, kept out of this backend work |
| B8 | Full accessibility audit (NFR2) | PARTIALLY COMPLETE | an automated axe check ran on 7 pages in both colour schemes (evidence/gp1-final-2026-11-27/accessibility/): 4 kinds of finding fixed without visual change. Colour contrast (mostly small secondary text) and heading order remain, because fixing them changes the visual identity. No manual screen-reader test and no testing with users with disabilities; automated checks cannot show WCAG conformance |
| B16 | Chaincode on Node.js 20 (end-of-life) | DEFERRED TO GP2 | the chaincode image uses `node:20-bookworm-slim`; its libraries (fabric-shim 2.5.8) support Node 22. Not migrated right before submission without a verified run (ORACLE_CLOUD_READINESS.md §4.5) | move to Node 22 in GP2 and re-run the chaincode tests, `fabric.yml` and the arm64 workflow |

## Needs people or approvals outside the code

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B9 | User acceptance testing and expert evaluation (GP481 §5.8) | BLOCKED | deferred by the project owner; needs a plan agreed with the supervisor and participant consent |
| B10 | Independent security review or penetration test | BLOCKED | the team's own review is in SECURITY_AUDIT.md; an external review needs someone outside the team |

## Environment limits seen here

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B11 | Building the chaincode image on this machine | BLOCKED here | npm inside Docker builds cannot reach the registry in this sandbox. The image from earlier was used, and the chaincode source is unchanged since b92b950. It built on the owner's Mac before. CI builds it in the *docker* job |
| B12 | This branch on macOS and WSL2 | IMPLEMENTED BUT NOT VERIFIED | every suite ran on Linux. The previous change set ran on the owner's Mac. WSL2 was never tested |
| B13 | Registry pull limits (Docker Hub and public.ecr.aws) | handled (the arm64 workflow also falls back to Google's Docker Hub mirror, mirror.gcr.io) | the second GitHub run failed when public.ecr.aws answered 429 to anonymous pulls. CI now pulls each base image with `.github/scripts/pull-image.sh`: the official image on Docker Hub, then the same image on the public.ecr.aws mirror, at most two attempts each, and no further attempts at a registry that answered 429. It logs in to Docker Hub when the repository has `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets. Nothing tries to get around a limit |

## Accepted limitations (not planned for GP482)

* One Fabric identity per organization, not per user (SECURITY_AUDIT.md F9).
* The single-host fabric-samples test network (one orderer, one peer per organization) is not a production network
  (F11).
* JWT in session storage, no multi-factor sign-in, an in-memory rate limit (F6 to F8).
* The ESLint packages are installed at pinned versions in CI (`--no-save`), not added to `package.json`.
  `no-explicit-any` and Prettier formatting are not enforced: 106 warnings remain in the existing code.
