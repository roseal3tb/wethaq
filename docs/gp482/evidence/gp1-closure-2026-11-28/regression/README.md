# Final regression, 28 November 2026

| Field | Value |
|---|---|
| Commit tested | `d0835da5b0a2a72380e04732875d8a41e9af5b9a` (branch `gp1-closure`, before the documentation commit) |
| Started / finished | 2026-11-28 17:42:46 UTC / 17:52:58 UTC, plus a re-run of the live tests at about 17:55 UTC |
| Machine | Linux x86_64 (the development sandbox, not a GitHub runner), Node v22.23.5, npm 10.9.9, Docker 29.9.3 |
| Script | `regress.sh.txt` (each suite writes its own file; `summary.txt` collects exit codes and durations) |

Later commits on the branch change only documentation and evidence, so these results apply to the code on the branch.

## Results

| Suite | Result | File |
|---|---|---|
| `npm ci` (dashboard) | exit 0 | `npm-ci.txt` |
| Type check (dashboard) | exit 0 | `typecheck.txt` |
| Production build | exit 0; Vite warns about a chunk over 500 kB (B7) | `build.txt` |
| Dashboard unit tests | 20 of 20 | `unit.txt` |
| ESLint | 0 errors, 106 warnings (see below) | `lint.txt` |
| Chaincode unit tests | 24 of 24 | `chaincode.txt` |
| API type check | exit 0 | `api-typecheck.txt` |
| API tests (local ledger) | 109 passed, 7 skipped (the 7 are `test/fabric.integration.test.ts`, which runs only against Fabric: see the Fabric rows) | `api.txt` |
| `npm audit --omit=dev --audit-level=high` (dashboard, API, chaincode) | 0 vulnerabilities each | `audit-*.txt` |
| Secret scan of tracked files (`.env`, identities, keys, backups, private-key blocks, common token formats) | nothing found | `secret-scan.txt` |
| Browser tests, Demo Mode (4 screen sizes) | 58 passed, 2 skipped (54 earlier tests and the new NFR2 test in 4 projects) | `demo-e2e.txt` |
| Browser tests, live mode against the API | first run: 3 passed, 6 failed; re-run: **9 of 9** | `live-e2e.txt`, `live-e2e-rerun.txt` |
| `fabric/install.sh` (pinned installer) | exit 0, both archives SHA-256 verified | `fabric-install.txt` |
| `fabric/up.sh --recreate` (fresh network) | exit 0 in 43 s; phase times in `up-phases.tsv` | `fabric-up.txt` |
| Migrations twice (must be idempotent) | exit 0 | `migrate-twice.txt` |
| Seed through the ledger | exit 0 | `seed.txt` |
| Fabric integration tests | 7 of 7 | `fabric-it.txt` |
| NFR checks on Fabric | **31 of 31**; slowest average write 540 ms; p95 reads and sign-in 84 ms; 20/20 concurrent in 0.21 s | `nfr.txt`, `nfr-report.md` |
| NFR with a wrong demo password (must fail) | exit 1 with "Could not sign in … Is DEMO_PASSWORD right?" (expected) | `nfr-negative.txt` |
| Routine stop and start (`stop.sh`, `start.sh`) | exit 0 both | `fabric-stop.txt`, `fabric-start.txt` |
| Persistence across the restart | ledger history of SHP-2026-0001 byte-identical before and after; PostgreSQL 79 shipments and highest block 77 before and after | `history-before.txt`, `history-after.txt`, `persistence.txt`, `persistence-ledger.txt` |
| Fabric integration tests after the restart | 7 of 7 | `consistency-after-restart.txt` |
| Browser test, full workflow on Fabric | 1 of 1 | `fabric-e2e.txt` |
| API production image build | exit 1 in this sandbox: `npm ci` inside the Docker build cannot reach the registry here and npm stops with "Exit handler never called". This is the same environment limit as B11. The image built on GitHub's arm64 runner on 28 Nov (`../../github-arm64-2026-11-28/api-image.log`) and in the CI *docker* job | `api-docker-build.txt` |

## Why the first live run failed

The regression script exports `DEMO_PASSWORD=ci-demo-password-1`, `LEDGER_MODE=fabric` and `DATABASE_URL` for the Fabric stages. The live-mode tests start their own in-memory API, which inherited those variables. The tests sign in with the password `demo`, so every test that signs in failed at the sign-in step, and the 3 tests that do not need a sign-in passed. Re-running the same command without those variables (`env -u DEMO_PASSWORD -u LEDGER_MODE -u DATABASE_URL -u JWT_SECRET npm run test:live`), which is how CI runs it, passed 9 of 9. No test or code was changed between the two runs. Both outputs are kept.

## ESLint warnings (106, no errors)

| Rule | Count | Where | Decision |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | 98 | 73 in API tests, 25 in API source | left as they are: typing them is a refactor with no functional change, and risky right before submission |
| `react-hooks/exhaustive-deps` | 5 | `src/App.tsx` (1), `src/context/Store.tsx` (2), `src/pages/Shipments.tsx` (2) | left as they are: adding dependencies can change when effects run, which would need its own testing |
| `react-refresh/only-export-components` | 3 | `src/components/UI.tsx`, `src/context/Store.tsx`, `src/theme/ThemeProvider.tsx` (helpers or context exported next to components) | affects hot reload in development only |

The ESLint configuration was not loosened to hide them.
