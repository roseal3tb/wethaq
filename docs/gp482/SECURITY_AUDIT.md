# Wethaq: security review

Date: 2026-11-27, updated for the GP1 submission on branch `gp1-final-readiness`. This is the development team's own review of the code and configuration in
this repository. It is **not** an independent audit, a penetration test or a certification. Each finding has its
status and how it was checked. Where nothing was run, the status says so.

## 1. Scope

* The API (`wethaq-api`): authentication, sessions, authorization, input handling, database access, logging and
  configuration.
* The chaincode and the Fabric scripts and identities.
* The dashboard: live mode only, plus token storage and headers. Demo mode has no server.
* The containers, `deploy/`, the CI workflows, dependencies and the repository's contents.

Out of scope: the hosting provider, the operating system of a future server, the physical security of the machines,
and the fabric-samples test network's own defaults beyond how Wethaq uses them.

## 2. Controls in place, with their checks

| Area | Control | Checked by |
| --- | --- | --- |
| Passwords | bcrypt (cost 10). Policy: 8 to 128 characters with a letter and a digit. Temporary passwords are random (12 characters), expire after `TEMP_PASSWORD_HOURS`, and must be replaced at first sign-in (until then only `/auth/password`, `/auth/me` and `/auth/logout` answer) | API tests; NFR *Passwords stored as bcrypt hashes*; bootstrap test |
| Sign-in | the same answer for a wrong password and an unknown email; 10 attempts per minute per address (also for password changes) | NFR checks; the 429 seen in the first NFR attempt |
| Tokens | HS256 with the algorithm pinned on verification; `JWT_SECRET` must be at least 32 random characters in production and known weak values are refused; 8 h lifetime | NFR *forged token*, *other key*, *expired token*; config tests |
| Sessions | server-side sign-out (`revoked_tokens` by token id). A password change or reset ends the user's other sessions (`session_version`). A deactivated user is refused | `sessions.test.ts` (8 tests); live browser tests |
| Authorization | every route checks the role on the server. The ledger organization (MSP) is taken from the user's organization in the database, never from the request | NFR role checks (Planner adds a user, Dispatcher requests, Receiver resets: 403); API tests |
| Smart contract | the five rules are enforced again by the chaincode, and the endorsement policy needs both organizations | chaincode tests (24); Fabric integration; Fabric browser test |
| SQL | parameterized queries everywhere. List filters are allow-listed, and the only interpolated parts (column lists, ORDER BY, placeholders) are constants in the code | code review of `services/*.ts`; NFR *SQL injection in the sign-in form* |
| Input | JSON bodies limited to 32 KB; ids, quantities, months and notes validated; malformed JSON answers 400 | API tests |
| Errors | unexpected errors answer `Internal server error` with no stack; the stack goes only to the server log | code review (`app.ts` error handler) |
| Logs and audit | JSON logs with a request id; values under password, token, secret, key and authorization keys are redacted. The audit log records sign-ins, sign-outs, password and user changes, refusals, ledger failures, reconciliation, consistency checks, checkpoint resets and the bootstrap. A trigger refuses UPDATE and DELETE on `audit_log` | API tests; integrity tests; CI *migrations* job (not run on GitHub yet) |
| Database integrity | CHECK constraints on quantities and status combinations; foreign keys; migrations applied in order and recorded | integrity tests; clean-init evidence |
| Demonstration features | `NODE_ENV=production` forces role switching and demo tools off, refuses `DEMO_PASSWORD`, and refuses `CORS_ORIGIN=*`. `npm run bootstrap` creates a real installation without demonstration accounts | config tests; local server check: `/auth/switch` and `/demo/invalid` answered 403 |
| HTTP headers | helmet on the API (CSP, HSTS, nosniff, frame options). Caddy adds HSTS, nosniff, frame denial, a referrer policy and a Content-Security-Policy for the dashboard | NFR *Security headers*; [csp-check.txt](evidence/completion-2026-11-27/csp-check.txt) with a negative control; `deploy/check-csp-hash.mjs` in CI |
| CORS | off by default (same origin); when set, exactly one origin | config tests |
| Fabric identities | the API uses a CA-enrolled client identity per organization (not admin); keys mode 600 in a git-ignored folder; `verify-network.sh` warns 30 days before expiry; renewal and revocation scripts | renewal executed; revocation drill with a disposable identity |
| Backups | Fabric archives are mode 600 and encrypted with AES-256-CBC and PBKDF2 when a passphrase is set; PostgreSQL dumps are the operator's files | Fabric drill (archive shown encrypted) |
| Containers | the API image runs as `node` (uid 1000) and contains no secrets. In `deploy/compose.yml` only Caddy publishes ports, and the API mounts only the two peers' TLS CA certificates (public) and its own identities | local server check (`docker ps`, `id -u`, file list in the container) |
| Repository | `.env`, `.env.*` (except the examples), `deploy/production.env`, `fabric/identities/` and `fabric/backups/` are git-ignored. The CI secret scan fails on tracked keys, identity or backup files, `.env` files and common token formats | the same patterns run locally on the tree and on the branch's history: 0 findings |
| Dependencies | `npm audit` in the dashboard, the API and the chaincode: 0 vulnerabilities, with and without dev dependencies. CI fails on moderate or higher runtime vulnerabilities | run on 2026-11-27 |
| CI | actions pinned to commit SHAs where they could be looked up; `persist-credentials: false`; no secrets in the workflow files (an optional Docker Hub login reads repository secrets) | review of `.github/workflows`. **Not run on GitHub** |

## 3. Findings

Severity is the team's judgement for this prototype on one machine. It is not a CVSS score.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | Sign-out only cleared the browser's copy of the token; the token stayed valid until it expired. A password reset did not end existing sessions | High | **Fixed and verified**: server-side sign-out and session versions (`sessions.test.ts`, live browser test) |
| F2 | A production installation had no way to create its first administrator without the demonstration seed, which production refuses | Medium | **Fixed and verified**: `npm run bootstrap` (test and evidence) |
| F3 | No Content-Security-Policy for the dashboard once it is served by a web server | Medium | **Fixed and verified** for `deploy/` (Caddy). The Vercel demo is unchanged and has no API or tokens |
| F4 | Mounting the whole test-network `organizations` folder into the API container would expose every peer's and orderer's private key to the API | Medium | **Fixed and verified**: only the two TLS CA certificates are mounted |
| F5 | After `renew-identities.sh`, the previous `wethaq-app` certificate stays valid until it expires (one year) | Low | **Open, operator decision**: `revoke-identity.sh <org> --certificate <old cert> superseded`. The script was tested on a disposable identity. Revoking a live identity was not done without explicit approval |
| F6 | The JWT is kept in the browser's session storage, so a script injected into the page could read it | Medium | **Mitigated**: CSP in `deploy/`, the dashboard never uses `dangerouslySetInnerHTML`, 8 h lifetime, server-side sign-out. HttpOnly cookies would need CSRF protection and a change to the API client; not done |
| F7 | The sign-in rate limit is kept in memory per API process and keyed by address; there is no per-account lockout | Low | **Open**: enough for one API process behind one proxy (`trust proxy` 1). Several API processes would need a shared store |
| F8 | No multi-factor sign-in | Medium | **Open**: out of scope for the prototype |
| F9 | One Fabric identity per organization, not per user: the ledger shows the organization, and the audit log shows the user | Medium | **Accepted limitation** (ARCHITECTURE.md §9) |
| F10 | The audit trigger stops application UPDATE and DELETE, but the table owner can drop it or TRUNCATE the table | Low | **Accepted**: documented. Separating the owner role from the API's role is recommended for a real installation |
| F11 | The test network uses fabric-samples defaults: one orderer, one peer per organization, CA registrar passwords from the samples, TLS certificates created by the scripts | High for production, acceptable for the prototype | **Accepted limitation**: not a production network. A real deployment needs its own CAs, changed registrar secrets, several orderers and HSM or protected key storage |
| F12 | PostgreSQL connections inside `deploy/compose.yml` are not encrypted | Low | **Accepted**: the database is only on an internal Docker network on the same host. Use TLS if the database moves to another host |
| F13 | `actions/setup-node` was referenced by its tag (`@v4`), not a commit SHA | Low | **Fixed on `gp1-final-readiness`**: every action is pinned by full commit SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2, all on Node 24). Effective once the pull-request checks pass on GitHub |
| F14 | A new database on a channel that already has shipments produces ids the chaincode refuses (no data is corrupted; the request fails with 502) | Low | **Documented** (DEPLOYMENT_GUIDE.md §9): use a new channel per installation |
| F15 | The NFR script exited 0 when a check failed, so the manual Fabric workflow reported success with 30 of 31 checks (a 429 on the sign-in SQL-injection check) | Medium (a security check could fail unnoticed) | **Fixed on `gp1-final-readiness`**: exit code 1 on any failed check, and a 65 s wait for the sign-in rate-limit window. Verified locally; needs one GitHub run |
| F16 | `fabric/install.sh` downloads Hyperledger's `install-fabric.sh` from the `main` branch (not pinned) | Low | **Open, GP2**: pin to a tag or commit before using it on a server (ORACLE_CLOUD_READINESS.md §4.2) |
| F17 | The chaincode image is based on Node.js 20, which is end-of-life | Medium for a deployment, none for the local prototype | **Deferred to GP2**: move to Node 22 with a verified run (ORACLE_CLOUD_READINESS.md §4.5) |

## 4. Not done

* No independent review, penetration test or automated web scan (such as OWASP ZAP).
* No load or denial-of-service testing beyond 20 concurrent requests.
* No review of a hosted environment, because none exists.
* The Fabric test network's own configuration was not hardened (F11).

## 5. Before any real deployment

1. Create a new Fabric network with the organization's own CAs and secrets, not the samples' (F11).
2. Keep `deploy/production.env` out of the repository, readable only by its owner, and generate every secret with
   `openssl rand -hex 32`.
3. After every identity renewal, revoke the superseded certificate (F5).
4. Run the manual Fabric and arm64 workflows and confirm the NFR security checks pass on GitHub (F15). Never open
   PostgreSQL, the Fabric ports, the API's port 4000 or the Docker socket to the internet
   (ORACLE_CLOUD_READINESS.md §7, step 6).
5. Have someone outside the team review the system before it holds real data.
