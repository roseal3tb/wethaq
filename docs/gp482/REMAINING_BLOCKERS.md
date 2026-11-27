# Wethaq: remaining blockers and open items

As of 2026-11-27, branch `gp482-final`. Each item names what is missing, why it is not done, and who or what can
unblock it. Everything else in [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) is complete and verified.
Because of the items below, the project is **not** 100% complete.

## Needs the project owner's action or approval

| # | Item | Status | Why | What unblocks it |
| --- | --- | --- | --- | --- |
| B1 | GitHub Actions: the manual `fabric.yml` | IMPLEMENTED BUT NOT VERIFIED | `checks.yml` and `browser-qa.yml` pass on GitHub (pull request #15, after two fixes). `fabric.yml` only runs when started by hand | Actions → *Fabric integration (manual)* → *Run workflow* |
| B2 | Hosted deployment (API, PostgreSQL and Fabric on a server, dashboard in live mode) | BLOCKED | not authorized; it needs a server or VM and a domain name, and may cost money. Nothing was provisioned | the owner chooses a host and authorizes it. `deploy/` and DEPLOYMENT_GUIDE.md §9 are ready and were checked locally |
| B3 | Revoking the superseded `wethaq-app` certificate after a renewal | IMPLEMENTED BUT NOT VERIFIED on a live identity | a change to the channel configuration of the existing network; only done with explicit approval. The same script was verified on a disposable identity | the owner runs `./fabric/revoke-identity.sh <1\|2> --certificate <old cert.pem> superseded` |
| B4 | Merge to `main` | BLOCKED | the owner merges. Vercel deploys `main` automatically; this branch leaves demo mode unchanged (54 demonstration tests pass) | review and merge |

## Needs a scope decision

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B5 | Cancellation, return and multi-step partial-receipt workflows (GP481 §6.5 and §6.6.5) | PARTIALLY COMPLETE | a short receipt is accepted and raises a Discrepancy alert. Cancellation, returns and receiving the rest later are not implemented: they need new chaincode functions and rules (a chaincode upgrade on both organizations) and new dashboard actions. That changes the agreed lifecycle, so the owner should decide whether they belong in GP482 |
| B6 | Importing a real parts catalogue and inventory | NOT IMPLEMENTED | `npm run bootstrap` creates an installation without demonstration data, but there is no import tool, and no real data is available (the project uses public and synthetic data) |
| B7 | Splitting the 951 KB dashboard bundle (GP481 §5.9) | NOT IMPLEMENTED | a frontend build change, kept out of this backend work |
| B8 | Full accessibility audit (NFR2) | PARTIALLY COMPLETE | keyboard and focus tests exist; no automated audit (axe) or manual screen-reader test was run |

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
| B13 | Registry pull limits (Docker Hub and public.ecr.aws) | handled | the second GitHub run failed when public.ecr.aws answered 429 to anonymous pulls. CI now pulls each base image with `.github/scripts/pull-image.sh`: the official image on Docker Hub, then the same image on the public.ecr.aws mirror, at most two attempts each, and no further attempts at a registry that answered 429. It logs in to Docker Hub when the repository has `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets. Nothing tries to get around a limit |

## Accepted limitations (not planned for GP482)

* One Fabric identity per organization, not per user (SECURITY_AUDIT.md F9).
* The single-host fabric-samples test network (one orderer, one peer per organization) is not a production network
  (F11).
* JWT in session storage, no multi-factor sign-in, an in-memory rate limit (F6 to F8).
* The ESLint packages are installed at pinned versions in CI (`--no-save`), not added to `package.json`.
  `no-explicit-any` and Prettier formatting are not enforced: 106 warnings remain in the existing code.
