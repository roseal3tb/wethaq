# Wethaq: user acceptance testing and expert evaluation kit

> **Status: PREPARED, NOT EXECUTED.** No participant has used this kit, no expert has reviewed the system, and no
> feedback, score or opinion exists. Nothing in this document is a result. GP481 §5.8 says the plan "will be agreed
> with the supervisor before it is run"; this kit is the draft for that discussion (prepared 2026-11-28).

The GP481 report's scope (§1.3.2) plans "a task-based usability assessment with non-military volunteers", and its
future work (§6.6, item 7) plans to "evaluate the system with representative users". This kit covers both: a
task-based session with volunteers, and a separate checklist for a domain or technical expert.

## 1. Before running

* Agree the plan, the number of participants and the consent wording with the supervisor.
* Use **Demo Mode** (<https://wethaqksu.vercel.app>) or a local live-mode installation (`README.md`). Do not
  present either as an operational system: all data is public (RAF) or synthetic.
* Participants are non-military volunteers. Collect no names in the result sheets: use codes P01, P02, ...
* Each session: about 30 minutes, one participant, one facilitator who reads the tasks and does not help unless the
  participant is stuck for 2 minutes (record that as an assist).
* Record per task: completed (yes / with assist / no), time in seconds, errors, and the participant's comments.

## 2. Participant instructions (read aloud)

> Thank you for helping. We are testing the website, not you. Wethaq is an academic prototype that helps plan
> spare parts and record shipments between two organizations. All data is invented or public. Please think aloud
> while you work. You can stop at any time. We will not record your name.

## 3. Tasks

| # | Role (demo switcher) | Task given to the participant | Success when |
| --- | --- | --- | --- |
| T1 | Logistics Planner | Sign in and find which part has the lowest estimated days of stock | the part named in *Inventory risk watch* is identified |
| T2 | Logistics Planner | Open the demand forecast for part RAF0002 and say which method has the lowest error | the model comparison is read correctly |
| T3 | Logistics Planner | Show the forecast as a table instead of a chart | *View as table* used |
| T4 | Logistics Planner | Create a shipment request for a part that needs reordering | request created and visible in *Shipments* |
| T5 | Dispatcher | Dispatch that request and mark it in transit | status shows *In transit* |
| T6 | Receiver | Confirm receipt of a smaller quantity than dispatched | receipt recorded and a discrepancy alert raised |
| T7 | Receiver | Try to confirm the same receipt again | the rejection and its reason are found |
| T8 | Any | Find the ledger record of the shipment and its transaction id | ledger tab entry opened |
| T9 | Admin | Deactivate a user and change another user's role | both changes saved |
| T10 | Any | Switch to dark mode and back; use the site on a phone-sized window | done without help |

## 4. Questionnaire (after the tasks)

**System Usability Scale** (J. Brooke, 1986; free to use with attribution). Scale 1 = strongly disagree to
5 = strongly agree.

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

Score: odd items (score − 1), even items (5 − score), sum × 2.5, giving 0 to 100.

**Wethaq-specific questions** (1 to 5, plus a comment):

* W1. I understood which data is synthetic or demonstration data.
* W2. I understood why a transaction was rejected.
* W3. I trust that a recorded shipment cannot be changed afterwards.
* W4. The forecast page helped me decide how much to reorder.
* Open: What was most confusing? What would you change first?

## 5. Acceptance criteria (proposed; to agree with the supervisor)

* Each of T1 to T10 completed without assist by at least 80 % of participants.
* Mean SUS score of at least 68 (the commonly cited average).
* No task in which a participant records a shipment action for the wrong role without noticing.
* Every critical issue found is either fixed or listed as a known limitation in the GP482 report.

## 6. Expert evaluation checklist

For one supply-chain or logistics expert and one software or blockchain expert, separately. Each item: agree /
partly / disagree, with a comment.

| Area | Statement |
| --- | --- |
| Domain | The four roles match how requests, dispatch and receipt are separated in practice |
| Domain | The five transaction rules (authorized organization, valid reference, valid transition, quantity, no duplicate) cover the main errors |
| Domain | Missing workflows (cancellation, returns, partial receipt in several steps) are acceptable for a prototype |
| Forecasting | Comparing methods with RMSSE on rolling origins is appropriate for intermittent demand |
| Inventory | The (s, S) policy comparison and its trade-off (fill rate against average stock) are presented fairly |
| Ledger | Endorsement by both organizations is a suitable trust model for transfers between two organizations |
| Ledger | Keeping accounts, forecasts and notes off-chain is appropriate |
| Security | One Fabric identity per organization (not per user) is acceptable for the prototype, given the API's audit log |
| Usability | The dashboard makes the state of each shipment and its ledger evidence clear |
| Limits | The documented limitations (REMAINING_BLOCKERS.md) are complete and honest |

## 7. Result sheet (blank)

| Participant | Task | Completed (Y / A / N) | Time (s) | Errors | Comment |
| --- | --- | --- | --- | --- | --- |
| P01 | T1 | | | | |

| Participant | SUS items 1–10 | SUS score | W1 | W2 | W3 | W4 | Open comments |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | | | | | | | |

| Expert | Area | Statement | Agree / partly / disagree | Comment |
| --- | --- | --- | --- | --- |
| E1 | | | | |

Store completed sheets outside the public repository if they contain anything that could identify a participant.
