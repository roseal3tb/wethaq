# GitHub Actions: Fabric integration (manual), 2026-11-27

The artifact `wethaq-fabric-run.zip` of a run of `.github/workflows/fabric.yml` on a GitHub-hosted runner
(`ubuntu-latest`, linux/x64), downloaded by the project owner and supplied on 2026-11-27. This was a **GitHub-hosted
integration test**: the Fabric test network, PostgreSQL and the API ran on the runner for the length of the job,
then were removed. It is not a cloud deployment.

## Artifact

| Item | Value |
| --- | --- |
| File received | `wethaq-fabric-run.zip`, 3 files, 37,727 bytes uncompressed |
| SHA-256 of the file received | `9c2342880debf3e3ed14c82301b8570ecd253202da92d0ea36fb2d0983e94225` |
| Integrity | `unzip -t`: no errors |
| Contents | `api.log` (137 lines, all `info`), `nfr-results/nfr-2026-11-27T21-55-12.md` and `.json` |
| Secret scan before committing | no private keys, tokens, passwords or authorization headers. The log holds request paths and demonstration e-mail addresses only. Files are copied unchanged |

## Run, as reported by the project owner from the GitHub Actions page

| Item | Value |
| --- | --- |
| Workflow | Fabric integration (manual), `fabric.yml` |
| Conclusion | success, 3 min 49 s |
| Fabric integration suite (`npm run test:fabric`) | 1 test file, **7 of 7 passed**, 0 failed |
| Fabric browser test (`playwright.fabric.config.ts`) | the step ran after the NFR step, and the run concluded *success*, so it exited 0. Its own output is not in the artifact |
| Warning | one annotation: `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` target Node.js 20 and were forced to run on Node.js 24 |
| Run URL, run ID, commit SHA, branch | **not recorded**: they are not in the artifact and were not supplied. `main` was at `17e9113` (pull request #16) when it ran, so that is the likely commit, but this is not confirmed from the run |

## What the artifact shows

* `api.log`: the API started in Fabric mode (`ledger: fabric`); every request is logged at `info`, with no warnings or
  errors.
* NFR report: measured 2026-11-27T21:55:12Z on linux/x64, Node v22.23.5. **30 of 31 checks passed.** The failed
  check is *SQL injection in the sign-in form*: it expected 400 or 401 and got **429**. The sign-in rate limit
  (10 per minute) had been used up by the integration suite, which signs in just before. The same collision happened
  locally (FINAL_TEST_REPORT.md, note 4).
* The NFR script exited 0 despite the failed check, so the workflow showed *success*. This hid the failure. Both
  defects are fixed on branch `gp1-final-readiness`:
  * `nfr.ts` now exits 1 when any check fails;
  * `fabric.yml` waits 65 s for the rate-limit window before the NFR step, as the documented local procedure does.
  The fixed workflow has to be run again on GitHub to confirm.

Response times on the runner (from the report): ledger writes 533 to 536 ms on average, reads and sign-in at most
115 ms at the 95th percentile, 20 concurrent requests in 0.35 s (57.0 tx/s).
