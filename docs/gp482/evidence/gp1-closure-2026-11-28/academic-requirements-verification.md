# Academic requirements: checked against the GP481 report

Checked on 28 November 2026 against `Wethaq GP481 Report v2.docx`, which was read and not changed. **No university requirements document, marking rubric or course specification for GP481, GP482, "GP1" or "GP2" was provided.** This check therefore uses only the project's own report. It does not say what the university requires.

## 1. Phase names: a question the project owner must answer

The GP481 report uses these names:

- **GP481 = Release 1.0 = Semester 1** (Table 1.8: Sprints 1 to 3). The report covers this phase.
- **GP482 = Release 2.0 = Semester 2** (Sprints 4 to 6). §6.6 "Future Work (GP482)" lists 7 items, and the abstract says the backend "will be built and evaluated in GP482".

The repository uses other names. The closure brief and the repository documents call this submission **"GP1"** and defer items to **"GP2"**. However, the documents sit in `docs/gp482/`, and they implement §6.6 items 1 to 4 and 6, which the report places in GP482.

There are two readings, and they lead to different conclusions:

| If… | Then the deferred items… |
|---|---|
| **A.** "GP1" is a milestone inside GP482, or the course was split differently from the report, and "GP2" comes later | can be deferred as this document does, provided the supervisor agrees |
| **B.** "GP1" means the final GP482 submission | B5 (cancellation, returns, partial receipt: §6.6 item 5) and B9 (evaluation with users: §6.6 item 7, §5.8) are **commitments the GP481 report made for GP482 that are not done**. They cannot just be relabelled "deferred". They must be reported as not done, with the reason |

This document does not pick one. **The project owner should confirm with the supervisor which reading applies.** The labels "DEFERRED TO GP2" in `REMAINING_BLOCKERS.md` assume reading A, and each one says what changes under reading B.

## 2. Functional requirements (Table 4.4)

The wording in the GP481 table was compared with the code and the tests. Status at the end of GP481 is shown, then the status now.

| ID | GP481 report: requirement (short) | GP481 status | Now | Evidence |
|---|---|---|---|---|
| FR1 | Sign in, access by role | demonstration sign-in; real authentication pending | COMPLETE AND VERIFIED | API tests; NFR security checks; live e2e |
| FR2 | Monthly forecast with error measures | implemented | COMPLETE AND VERIFIED (precomputed results, not real-time) | analytics tests; reproduction byte for byte |
| FR3 | Compare forecasting methods | implemented | COMPLETE AND VERIFIED | analytics tests |
| FR4 | Stock on hand, in transit, reorder point, status | implemented with synthetic data | COMPLETE AND VERIFIED (still synthetic Dataset C) | sync tests; live and Fabric e2e |
| FR5 | Replenishment quantity reviewed before a request | implemented | COMPLETE AND VERIFIED | demo, live and Fabric e2e |
| FR6 | Planner creates a request (part, destination, forecast month) | implemented | COMPLETE AND VERIFIED, also on the ledger | API tests; Fabric IT |
| FR7 | Dispatch, in transit, receipt | implemented (simulated records) | COMPLETE AND VERIFIED on Fabric | chaincode tests; Fabric IT; NFR 10 of 10 workflows |
| FR8 | Rules before recording; rejection recorded with reason | simulated; smart contract pending | COMPLETE AND VERIFIED (five rules in chaincode; rejected attempts on the ledger) | chaincode tests; NFR rule checks |
| FR9 | Accepted operations on a permissioned ledger, verifiable | pending | COMPLETE AND VERIFIED | Fabric IT; consistency check; fabric.yml run 46169704428 |
| FR10 | One dashboard | implemented | COMPLETE AND VERIFIED (design unchanged) | demo and live e2e |
| FR11 | Alerts for shortages, discrepancies, delays, rejected attempts; acknowledgement | implemented | COMPLETE AND VERIFIED | API tests; demo e2e at 4 sizes |
| FR12 | Administrator manages users and roles | implemented in the demonstration | COMPLETE AND VERIFIED through the API | API tests; NFR role checks |

## 3. Non-functional requirements (Table 4.5)

| ID | GP481 report: requirement (short) | GP481 status | Now | Evidence |
|---|---|---|---|---|
| NFR1 | Works on mobile, tablet, desktop without horizontal scrolling | tested at four sizes | COMPLETE AND VERIFIED | demo e2e, 58 passed at 390, 430, 768, 1440 px |
| NFR2 | Keyboard navigation, visible focus, reduced motion, table alternative for the main chart | partly tested | **COMPLETE AND VERIFIED for the four criteria the report names**, with one gap: visible focus is styled but not checked by a test. Colour contrast is not an NFR2 criterion, but axe reports it, and it is recorded as a risk (B8). No manual screen-reader test. This is not WCAG conformance | `accessibility/README.md`; new NFR2 test |
| NFR3 | Synthetic, simulated and real data labelled; nothing invented | implemented | COMPLETE AND VERIFIED | live e2e; analytics provenance |
| NFR4 | CSV exports cannot carry formulas | implemented and tested | COMPLETE AND VERIFIED | unit tests |
| NFR5 | Passwords and tokens protected; authorization on the server | pending (needs the backend) | COMPLETE AND VERIFIED for the prototype; no independent review (B10) | NFR 17 security checks; SECURITY_AUDIT.md |
| NFR6 | Accepted ledger record cannot be changed | pending (needs Fabric) | COMPLETE AND VERIFIED | NFR integrity checks |
| NFR7 | Pages load and respond within an acceptable time | not measured | COMPLETE AND VERIFIED on the test machines (target 2,000 ms set by the NFR script, not by the report) | fabric.yml run 46169704428: slowest average write 536 ms, p95 reads 127 ms |

**NFR7 note.** The report does not give a number for "acceptable". The 2,000 ms target comes from the project's NFR script. The report should say where that target comes from.

## 4. Planned evaluations and future work

| GP481 section | What it planned | Now |
|---|---|---|
| §5.6 smart-contract testing | each rule with one accepted and one rejected transaction | COMPLETE AND VERIFIED (24 chaincode tests) |
| §5.7 integration testing | routes return what the dashboard expects; real transaction hash; rejections shown | COMPLETE AND VERIFIED in a different way (live e2e and Fabric e2e instead of re-running the demo tests) |
| §5.8 user acceptance testing | plan agreed with the supervisor, then run; results "reported in the next release" | **not run**. Materials prepared: `UAT_AND_EXPERT_EVALUATION_KIT.md` (labelled prepared, not executed) |
| §5.9 bundle splitting "in a later iteration" | split the bundle | not done (951 KB) |
| §6.6.1 to §6.6.3 backend, schema, Fabric | build them | COMPLETE AND VERIFIED |
| §6.6.4 stored forecasts, correct model labelling | | PARTIALLY COMPLETE (served from checksummed files, not database rows; labelling corrected) |
| §6.6.5 cancellation, return, partial receipt | add these workflows | **not done**. A short receipt is accepted and raises a Discrepancy alert |
| §6.6.6 notification at 390 px; outdated tests | fix them | COMPLETE AND VERIFIED |
| §6.6.7 evaluation with representative users; performance against the NFRs | | performance COMPLETE AND VERIFIED; user evaluation **not done** |

## 5. Scope statements in the report

- **Out of scope in GP481:** "full-scale deployment". The repository does not deploy WETHAQ anywhere. Actual cloud deployment is intentionally deferred until GP2. WETHAQ has not been deployed to Oracle Cloud during GP1.
- **In scope:** a "task-based usability assessment with non-military volunteers". It has not been carried out. The kit is ready for it.
