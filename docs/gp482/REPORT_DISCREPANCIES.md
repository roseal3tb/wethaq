# Wethaq: the GP481 report compared with the GP482 implementation

The GP481 report (`Wethaq GP481 Report v2.docx`) was **not changed**. This page lists where the implementation now
differs from what the report says. The differences fall into three kinds: the implementation went further than the
report, it did something in a different way, or it did not do something the report planned. It covers the
requirements (Tables 4.4 and 4.5), the design (§4.3, §4.4), the planned testing (§5.6 to §5.9), and the limitations
and future work (§6.5, §6.6). The research results in `analysis/results/` were not changed, and were reproduced
byte for byte ([evidence](evidence/completion-2026-11-27/python-reproduction.txt)).

Each row gives the report's statement, what is true now, and what the GP482 report should say. The authors decide
the wording. Statuses use the labels of [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md).

## 1. Functional requirements (Table 4.4)

| ID | GP481 status | Now | Note for the GP482 report |
| --- | --- | --- | --- |
| FR1 sign-in and role access | demonstration sign-in; real authentication pending | **COMPLETE AND VERIFIED**: bcrypt passwords, JWT, server-side authorization on every route, server-side sign-out, temporary passwords | the demonstration accounts still exist for demonstrations and are refused in production |
| FR2 monthly forecast with error measures | implemented | **COMPLETE AND VERIFIED**, unchanged results | in live mode the forecasts come from the API, read from the **precomputed** result files of the offline Python analysis with SHA-256 provenance. They are not computed on request and must not be described as real-time predictions |
| FR3 compare forecasting methods | implemented | **COMPLETE AND VERIFIED** | also available as `/api/analytics/v1/model-comparison` and `/rolling` |
| FR4 stock on hand, in transit, reorder point, status | implemented with synthetic data | **COMPLETE AND VERIFIED** in live mode from PostgreSQL, changed once per committed ledger transaction | the data is still the synthetic Dataset C |
| FR5 replenishment recommendation reviewed by the planner | implemented | **COMPLETE AND VERIFIED** (the request form; quantity and note checked by the API) | — |
| FR6 planner creates a request | implemented | **COMPLETE AND VERIFIED**, registered on the ledger (`RegisterRequest`) | the report's Table 4.8 lists dispatch, transit and receipt as ledger operations. The request itself is now also on the ledger |
| FR7 dispatch, in transit, receipt | implemented (simulated records) | **COMPLETE AND VERIFIED** on Hyperledger Fabric 2.5.12 with endorsement by both organizations | — |
| FR8 rules checked, rejections recorded with reason | simulated; smart contract pending | **COMPLETE AND VERIFIED**: the five rules run in the chaincode, and a rejected attempt is written to the ledger with the failed rule and reason | Table 4.8 says rejected attempts are off-chain. That remains true for refusals by the API (role, validation), but refusals by the smart contract are **on-chain** |
| FR9 accepted operations on a permissioned ledger, verifiable | pending | **COMPLETE AND VERIFIED**: real Fabric transaction ids and blocks; `VerifyShipment` and a per-shipment check; an administrator's consistency check of the whole database against the ledger | — |
| FR10 one dashboard for everything | implemented | **COMPLETE AND VERIFIED** (design unchanged) | — |
| FR11 alerts, acknowledgement | implemented | **COMPLETE AND VERIFIED**, plus *Pending transaction* and *Ledger sync* alerts | new alert types should be listed |
| FR12 administrator manages users and roles | implemented in the demonstration | **COMPLETE AND VERIFIED** through the API, including deactivation, password reset that ends sessions, and the first administrator of a new installation (`npm run bootstrap`) | — |

## 2. Non-functional requirements (Table 4.5)

| ID | GP481 status | Now | Note |
| --- | --- | --- | --- |
| NFR1 usability at four screen sizes | tested | **COMPLETE AND VERIFIED**: 54 demonstration browser tests at 390, 430, 768 and 1440 px | unchanged design |
| NFR2 accessibility | partly tested | **COMPLETE AND VERIFIED for the four criteria the report names** (keyboard navigation, visible focus, reduced motion, table alternative), with a new test for the table alternative and heading levels. An automated axe check was run; colour contrast below 4.5:1 remains and is documented (B8) | the report can say the NFR2 criteria are met and tested, that an automated check was run, and that contrast is a known issue. Do not claim WCAG conformance; no screen-reader or user test was done |
| NFR3 transparency of synthetic, simulated and real data | implemented | **COMPLETE AND VERIFIED**: the live ledger tab names Fabric or the local development ledger; analytics answers carry provenance and say the results are precomputed | — |
| NFR4 CSV exports without formulas | implemented and tested | **COMPLETE AND VERIFIED** (unchanged tests) | — |
| NFR5 passwords and tokens protected, server authorization | pending | **COMPLETE AND VERIFIED** for the prototype (see [SECURITY_AUDIT.md](SECURITY_AUDIT.md)) | no independent security review; limitations F5 to F13 |
| NFR6 accepted ledger record cannot be changed | pending | **COMPLETE AND VERIFIED**: a second receipt is refused by the chaincode and earlier records are unchanged; a change made directly in PostgreSQL is detected by verification (NFR checks) | the guarantee comes from Fabric's append-only ledger. PostgreSQL is only a copy, and it can be checked against the ledger |
| NFR7 performance | not measured | **COMPLETE AND VERIFIED** on the test machines (also on GitHub x64, run 46169704428: 536 ms slowest average write, 127 ms p95 reads). Earlier local figures: ledger writes 543 ms on average (slowest operation type), reads and sign-in at the 95th percentile 115 ms, 20 concurrent requests committed in 0.26 s (76.2 tx/s) ([NFR report](evidence/completion-2026-11-27/final-run/nfr-report.md)) | the numbers come from the single-host test network. They are not a capacity statement for a deployment |

## 3. Design (§4.3 and §4.4)

| Section | Report | Implementation | Kind |
| --- | --- | --- | --- |
| §4.3.1, Figure 4.3 | the service will "take forecasts from the Python pipeline" | the API serves the result files that the offline pipeline wrote. `MANIFEST.json` records their checksums, and each answer says whether the files are verified, modified, outdated or unverified. The pipeline is not run by the API | different way |
| §4.3.1 | dashboard → Express → PostgreSQL and Fabric Gateway | as designed, plus components the report does not describe: an operation log written before each submission, a chaincode event consumer with a checkpoint, a reconciler for unknown outcomes, the local development ledger for tests, and chaincode as a service | beyond the report |
| §4.3.6 | fabric-samples test network, Org1 issuing, Org2 receiving, five rules, endorsement by both, user permissions in the API, limited data on the ledger | as designed (`AND(Org1MSP.peer, Org2MSP.peer)`) | matches |
| §4.3.6 | (not discussed) | Fabric CA identities per organization for the API, renewal and revocation scripts, network backup and restore | beyond the report |
| §4.4.3 | PostgreSQL holds users, roles, parts, locations, inventory, **forecasts**, shipments, events, alerts and ledger copies | all of these except forecasts are used. The `forecasts` table exists but stays empty, because forecasts are served from the result files. Added tables: `ledger_operations`, `event_checkpoints`, `audit_log`, `revoked_tokens`, and the local ledger's tables | different way; beyond the report |
| §4.4.4, Table 4.8 on-chain | shipment and part id, operation type, quantity, organization, status before and after, time | all of these, plus the request operation, rejected attempts by the chaincode (failed rule and reason), the Fabric transaction id, and a shipment state with its quantities. No user names, notes or other personal data are on the ledger | beyond the report (rejections, FR8) |
| §4.4.4, Table 4.8 off-chain | accounts, inventory, forecasts, notes, alert details, application-layer rejections, reporting copies | as described | matches |
| §4.4.1, Table 4.7 | three data sources never joined | unchanged. Dataset C seeds the database | matches |

## 4. Planned testing (§5.6 to §5.9)

| Section | Report | Now |
| --- | --- | --- |
| §5.6 smart-contract testing (planned): each rule with an accepted and a rejected transaction | done. 24 chaincode tests include a rejected case for each of the five rules and accepted workflows. The Fabric integration suite and the browser test repeat this on the real network | **COMPLETE AND VERIFIED** |
| §5.7 integration testing (planned): 13 routes; real transaction hash; rejections shown; re-run the end-to-end tests against the backend | the API now has 43 documented operations (OpenAPI 0.4.0). The real Fabric transaction id is checked on the peer and in PostgreSQL, and rejections are shown as rejected attempts. Instead of re-running the 54 demonstration tests against the backend, there are 9 live-mode browser tests and one full workflow test on Fabric. The 54 demonstration tests still run in demo mode | **COMPLETE AND VERIFIED**, in a different way than planned |
| §5.8 user acceptance testing (planned) | not done; no participants | **DEFERRED TO GP2**, materials prepared but not executed ([UAT_AND_EXPERT_EVALUATION_KIT.md](UAT_AND_EXPERT_EVALUATION_KIT.md)). Needs the supervisor's agreement and participant consent. If this is the final GP482 submission, report it as planned and not done (see §7) |
| §5.9 performance, security and availability not measured; bundle of 909 KB should be split | measured (NFR 31 of 31; outages of PostgreSQL, orderer and peer handled). The bundle is now 951 KB (274 KB gzipped) and was not split | measurement **COMPLETE AND VERIFIED**; bundle splitting **not done** (frontend change, outside this backend work) |

## 5. Limitations and future work (§6.5 and §6.6)

| Item | Now |
| --- | --- |
| §6.6.1 backend API with real authentication and server-side authorization | **COMPLETE AND VERIFIED** |
| §6.6.2 PostgreSQL schema and demonstration data moved into it | **COMPLETE AND VERIFIED** (migrations 001 to 005, seed) |
| §6.6.3 Fabric test network, chaincode, endorsement by both organizations | **COMPLETE AND VERIFIED** |
| §6.6.4 dashboard connected to stored forecasts and simulation results, model labeling corrected | **PARTIALLY COMPLETE**: live mode reads the results through the API with checksums. They are stored files on the server, not database rows. The label is corrected: the code and the analytics provenance name scikit-learn's HistGradientBoostingRegressor, and the dashboard's chart calls the illustrative series "Synthetic ML candidate", not XGBoost |
| §6.6.5 cancellation, returns and partial receipts | **NOT IMPLEMENTED** (DEFERRED TO GP2 under reading A of §7). A receipt of fewer items than dispatched is accepted and raises a Discrepancy alert, but there is no cancellation, no return and no second receipt for the rest. It needs new chaincode functions, rules and dashboard actions; see [REMAINING_BLOCKERS.md](REMAINING_BLOCKERS.md) |
| §6.6.6 notification at 390 px covering *Acknowledge*; outdated browser tests | **COMPLETE AND VERIFIED**: the acknowledgement test passes at 390 px and at the other three sizes, and the outdated tests no longer fail (54 of 54 passed) |
| §6.6.7 evaluation with users; performance against the NFRs | performance **COMPLETE AND VERIFIED**; user evaluation **DEFERRED TO GP2**, materials prepared (as §5.8) |
| §6.5 "the backend, database and blockchain layers are not implemented" | no longer true |
| §6.5 "login is a demonstration mechanism" | no longer true in live mode. Demo mode on Vercel keeps its demonstration sign-in |
| §6.5 the RAF dataset is not from a Saudi military context; Dataset C is synthetic | unchanged and still true |
| §6.5 the rolling gradient-boosting settings overlap one origin's test months; the RMSSE scale differs from M5 | **unchanged on purpose**: the research method and results were not altered. Still to be disclosed in GP482 |
| §6.5 no user study | unchanged |

## 6. Statements the GP482 report should avoid

These statements would be wrong, given the evidence above:

* "Deployed", "in production" or "production-ready". Nothing was deployed to a server. The Vercel site is the
  demonstration without a backend (Demo Mode, not connected to any blockchain network). The single-server
  configuration was only checked locally. Actual cloud deployment is intentionally deferred until GP2; WETHAQ has
  not been deployed to Oracle Cloud during GP1.
* "Runs on Oracle Cloud" or "deployed on ARM64". WETHAQ passed its tests natively on a GitHub-hosted arm64 runner
  (2026-11-28); that is a test, not a deployment, and nothing ran on an Oracle server.
* Any user acceptance testing or expert evaluation results. None were collected in GP1.
* "Real-time forecasting". The forecasts are precomputed results of the offline analysis.
* "All CI passes" without qualification. The pull-request checks pass on GitHub, and the manual Fabric workflow
  passed on `main` on 2026-11-28 (run 46169704428: 7 of 7, NFR 31 of 31). The first manual run, on 2026-11-27,
  showed NFR 30 of 31 hidden by an exit code 0, which was then fixed. The closure branch `gp1-closure` passed
  both manual workflows too (2026-11-28).
* "Meets WCAG 2.2 AA". Only an automated check was run, and it still reports contrast issues.
* Peak or capacity figures for Oracle. The arm64 peaks were measured on a GitHub runner, not on Oracle.
* "Security-certified", "penetration-tested" or "WCAG-compliant".
* "Per-user blockchain signatures". The ledger is signed per organization.

## 7. Phase names (to confirm with the supervisor)

The GP481 report calls the phases **GP481** (Release 1, Semester 1) and **GP482** (Release 2, Semester 2), and lists
the backend, the Fabric network, cancellation and returns, and user evaluation as GP482 work (§6.6). This
repository and the closure brief call the current submission **"GP1"** and defer items to **"GP2"**, while the
documents sit in `docs/gp482/`. No university requirements document was provided to settle it.

* **Reading A.** "GP1" is a milestone inside GP482 (or the course is organized differently from the report), and
  "GP2" is still to come. The deferrals in REMAINING_BLOCKERS.md stand, with the supervisor's agreement.
* **Reading B.** "GP1" is the final GP482 submission. Then §6.6 items 5 (cancellation, return, partial receipt)
  and 7 (evaluation with users) are planned items that were not done. The report should say so plainly and give the
  reason, rather than call them deferred.

Suggested wording for either reading: "The GP481 report planned cancellation, return and partial-receipt workflows
and an evaluation with representative users for GP482. They were not carried out in this phase. A short receipt is
recorded and raises a discrepancy alert, and the evaluation materials are prepared but have not been used."

## 8. Updates from the GP1 closure (2026-11-28)

| Item | Earlier statement in these documents | Now |
| --- | --- | --- |
| Manual Fabric workflow on GitHub | NFR 30 of 31; one more run needed | run 46169704428 on `main`: 31 of 31 |
| Pull-request checks | "reported passing by the owner" | read on GitHub and recorded with run ids |
| Fabric installer | unpinned upstream helper (finding F16) | pinned and checksum-verified |
| NFR2 | partially complete | the four named criteria tested; contrast documented |
| arm64 resource figures | "the whole stack used well under 1 GB" | that was memory at rest; measured peaks are about 0.34 GB of containers without a limit and about 0.53 GB for everything under a 2 CPU / 12 GB limit, on a GitHub runner |

