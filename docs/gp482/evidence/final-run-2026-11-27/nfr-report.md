# Wethaq NFR measurements

Measured 2026-11-27T18:48:22.827Z against http://127.0.0.1:4000/api with the Hyperledger Fabric test network (2 organizations, 1 orderer, endorsement by both organizations).
10 workflow runs one at a time, then 20 requests at once. Target response time: 2000 ms.
Node v22.23.5 on linux/x64.

Result: 31 of 31 checks passed.

## Response times

| Action | Runs | Average | Median | 95th percentile | Max |
|---|---|---|---|---|---|
| Sign in | 4 | 113 ms | 101 ms | 146 ms | 146 ms |
| Create request (Planner, ledger) | 10 | 541 ms | 539 ms | 551 ms | 551 ms |
| Dispatch (Dispatcher, ledger) | 10 | 538 ms | 537 ms | 542 ms | 542 ms |
| Mark in transit (Dispatcher, ledger) | 10 | 544 ms | 536 ms | 604 ms | 604 ms |
| Confirm receipt (Receiver, ledger) | 10 | 540 ms | 537 ms | 556 ms | 556 ms |
| Verify against ledger | 10 | 17 ms | 17 ms | 21 ms | 21 ms |
| Load dashboard data (/state) | 10 | 11 ms | 10 ms | 18 ms | 18 ms |
| Create request, 20 at once | 20 | 220 ms | 220 ms | 228 ms | 229 ms |

Throughput: 20 of 20 concurrent requests committed in 0.23 s (86.6 transactions per second).

Note: a ledger write returns once its block is committed. The orderer cuts a block after its BatchTimeout (500 ms in fabric/up.sh; the sample network's default is 2 s) or as soon as 10 transactions are waiting, so a single write waits for the timeout while concurrent writes share blocks.

## Checks

| Quality attribute | Test | Expected | Observed | Result |
|---|---|---|---|---|
| Performance | Average time of each ledger write (one at a time) | < 2000 ms | slowest average 544 ms | Pass |
| Performance | Reads and sign-in (95th percentile) | < 2000 ms | slowest 146 ms | Pass |
| Performance | 20 concurrent shipment requests | all committed | 20/20 committed in 0.23 s (86.6 tx/s) | Pass |
| Reliability | Workflow runs without errors (10 × request, dispatch, transit, receipt) | 0 errors | 0 errors, 10/10 completed | Pass |
| Security | Data without signing in | 401 | 401 | Pass |
| Security | Forged token | 401 | 401 | Pass |
| Security | Admin token signed with another key | 401 | 401 | Pass |
| Security | Expired token | 401 | 401 | Pass |
| Security | Wrong password and unknown email give the same answer | 401, same message | 401 / 401, same message | Pass |
| Security | SQL injection in the sign-in form | 400 or 401 | 401 | Pass |
| Security | Planner adds a user | 403 | 403 | Pass |
| Security | Dispatcher creates a shipment request | 403 | 403 | Pass |
| Security | Receiver resets a password | 403 | 403 | Pass |
| Security | Dispatcher changes a role | 403 | 403 | Pass |
| Security | Planner records a dispatch (refused before the ledger) | 422, not submitted | 422, application, not submitted | Pass |
| Security | Receiver records a dispatch (refused before the ledger) | 422, not submitted | 422, application, not submitted | Pass |
| Security | Dispatcher confirms a receipt (refused before the ledger) | 422, not submitted | 422, application, not submitted | Pass |
| Security | A non-admin sees only their own user record | 1 user | 1 user(s) | Pass |
| Security | Password hashes are never returned by the API | not present | not present | Pass |
| Security | Passwords stored as bcrypt hashes | all users | 8/8 | Pass |
| Security | Security headers (helmet) | 4 headers | 4: x-content-type-options, content-security-policy, strict-transport-security, x-frame-options | Pass |
| Integrity | Completed shipments match the ledger | 10/10 | 10/10 | Pass |
| Integrity | A change made directly in PostgreSQL is detected | mismatch reported | detected: Received quantity: database 10, ledger 5 | Pass |
| Integrity | A second receipt is refused by the smart contract | noDuplicate | 422, noDuplicate (chaincode, block 92) | Pass |
| Integrity | Earlier ledger records are unchanged; the attempt is appended | unchanged, +1 record | unchanged, +1 record | Pass |
| Integrity | The shipment state is unchanged after the rejected attempt | unchanged | unchanged | Pass |
| Reliability | Rule noDuplicate: Duplicate receipt | rejected by noDuplicate | rejected by noDuplicate (chaincode) | Pass |
| Reliability | Rule authorizedOrg: Unauthorized organization | rejected by authorizedOrg | rejected by authorizedOrg (chaincode) | Pass |
| Reliability | Rule validTransition: Invalid status transition | rejected by validTransition | rejected by validTransition (chaincode) | Pass |
| Reliability | Rule validQuantity: Quantity exceeds dispatched | rejected by validQuantity | rejected by validQuantity (chaincode) | Pass |
| Reliability | Rule validReference: Unknown shipment reference | rejected by validReference | rejected by validReference (chaincode) | Pass |
