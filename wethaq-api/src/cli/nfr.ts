/**
 * Non-functional requirement (NFR) measurements for Chapter 5: performance, security, integrity and reliability.
 * Runs against a running Wethaq API (npm run dev) and its PostgreSQL database, and writes the results to
 * nfr-results/ as Markdown (for the report) and JSON (raw numbers).
 *
 *   npm run nfr                     # 10 workflow runs, 20 concurrent requests
 *   npm run nfr -- --runs 30 --concurrency 50
 *
 * It creates and completes real shipments on the ledger (review note "NFR test run"), so run it on a
 * demonstration network, not on data you want to keep unchanged.
 */
import '../env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';
import { postgres } from '../db.js';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const RUNS = arg('runs', 10);
const CONCURRENCY = arg('concurrency', 20);
const TARGET_MS = arg('target', 2000);
const API = (process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 4000}/api`).replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || 'demo';
const config = loadConfig();
const db = postgres(config.databaseUrl);

interface Reply { status: number; body: any; ms: number; headers: Headers }
async function call(method: string, route: string, token?: string, body?: unknown): Promise<Reply> {
  const started = performance.now();
  const res = await fetch(API + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
  return { status: res.status, body: parsed, ms, headers: res.headers };
}

interface Check { area: string; test: string; expected: string; observed: string; passed: boolean }
const checks: Check[] = [];
const check = (area: string, test: string, expected: string, observed: string, passed: boolean) => {
  checks.push({ area, test, expected, observed, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  [${area}] ${test} — ${observed}`);
};

const timings: Record<string, number[]> = {};
const time = (label: string, reply: Reply) => { (timings[label] ??= []).push(reply.ms); return reply; };
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { n: sorted.length, avg: sorted.reduce((a, b) => a + b, 0) / sorted.length, min: sorted[0], p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1] };
};
const ms = (v: number) => `${Math.round(v)} ms`;

async function main() {
  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) throw new Error(`The API is not reachable at ${API}. Start it with npm run dev first.`);
  const ledgerKind: string = health.body.ledger;
  console.log(`Wethaq NFR measurements against ${API} (ledger: ${ledgerKind}), ${RUNS} runs, ${CONCURRENCY} concurrent requests\n`);

  // Sign in as the four demonstration roles.
  const token: Record<string, string> = {};
  for (const role of ['planner', 'dispatcher', 'receiver', 'admin']) {
    const res = time('Sign in', await call('POST', '/auth/login', undefined, { email: `${role}@wethaq.demo`, password: PASSWORD }));
    if (res.status !== 200) throw new Error(`Could not sign in as ${role}@wethaq.demo (${res.status} ${JSON.stringify(res.body)}). Is DEMO_PASSWORD right?`);
    token[role] = res.body.token;
  }

  // ---------- Performance: the full shipment workflow, one step at a time ----------
  const completed: string[] = [];
  let workflowErrors = 0;
  for (let i = 0; i < RUNS; i++) {
    const qty = 5 + (i % 5);
    const created = time('Create request (Planner, ledger)', await call('POST', '/shipments', token.planner, { partId: `SP-${String(1 + (i % 60)).padStart(3, '0')}`, location: 'Central Warehouse', qty, month: '2026-12', note: 'NFR test run' }));
    if (created.status !== 201) { workflowErrors++; continue; }
    const id = created.body.id as string;
    const steps: [string, string, string, number | undefined][] = [
      ['Dispatch (Dispatcher, ledger)', 'dispatch', 'dispatcher', qty],
      ['Mark in transit (Dispatcher, ledger)', 'transit', 'dispatcher', undefined],
      ['Confirm receipt (Receiver, ledger)', 'receive', 'receiver', qty]
    ];
    let ok = true;
    for (const [label, op, who, q] of steps) {
      const res = time(label, await call('POST', `/shipments/${id}/${op}`, token[who], { qty: q, note: 'NFR test run' }));
      if (res.status !== 200 || !res.body.passed) { ok = false; workflowErrors++; break; }
    }
    if (ok) completed.push(id);
    time('Verify against ledger', await call('GET', `/shipments/${id}/verify`, token.dispatcher));
    time('Load dashboard data (/state)', await call('GET', '/state', token.admin));
  }

  // ---------- Performance: concurrent requests (throughput) ----------
  const burstStarted = performance.now();
  const burst = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) =>
    call('POST', '/shipments', token.planner, { partId: `SP-${String(1 + (i % 60)).padStart(3, '0')}`, location: 'Distribution Center', qty: 1, month: '2026-12', note: 'NFR test run (concurrent)' })));
  const burstSeconds = (performance.now() - burstStarted) / 1000;
  const burstOk = burst.filter(r => r.status === 201).length;
  burst.forEach(r => time(`Create request, ${CONCURRENCY} at once`, r));

  const perf = Object.entries(timings).map(([action, values]) => ({ action, ...stats(values) }));
  const ledgerWrites = perf.filter(p => /ledger\)$/.test(p.action));
  const worstAvg = Math.max(...ledgerWrites.map(p => p.avg));
  check('Performance', 'Average time of each ledger write (one at a time)', `< ${TARGET_MS} ms`, `slowest average ${ms(worstAvg)}`, worstAvg < TARGET_MS);
  const reads = perf.filter(p => ['Verify against ledger', 'Load dashboard data (/state)', 'Sign in'].includes(p.action));
  const worstRead = Math.max(...reads.map(p => p.p95));
  check('Performance', 'Reads and sign-in (95th percentile)', `< ${TARGET_MS} ms`, `slowest ${ms(worstRead)}`, worstRead < TARGET_MS);
  check('Performance', `${CONCURRENCY} concurrent shipment requests`, 'all committed', `${burstOk}/${CONCURRENCY} committed in ${burstSeconds.toFixed(2)} s (${(burstOk / burstSeconds).toFixed(1)} tx/s)`, burstOk === CONCURRENCY);
  check('Reliability', `Workflow runs without errors (${RUNS} × request, dispatch, transit, receipt)`, '0 errors', `${workflowErrors} errors, ${completed.length}/${RUNS} completed`, workflowErrors === 0);

  // ---------- Security ----------
  const noToken = await call('GET', '/state');
  check('Security', 'Data without signing in', '401', String(noToken.status), noToken.status === 401);
  const forged = await call('GET', '/state', 'not-a-real-token');
  check('Security', 'Forged token', '401', String(forged.status), forged.status === 401);
  const otherKey = jwt.sign({ sub: 'USR-001', role: 'Admin' }, 'a-different-secret', { algorithm: 'HS256', expiresIn: '1h' });
  const wrongKey = await call('GET', '/state', otherKey);
  check('Security', 'Admin token signed with another key', '401', String(wrongKey.status), wrongKey.status === 401);
  const expired = jwt.sign({ sub: 'USR-001', role: 'Admin', exp: Math.floor(Date.now() / 1000) - 60 }, config.jwtSecret, { algorithm: 'HS256' });
  const expiredRes = await call('GET', '/state', expired);
  check('Security', 'Expired token', '401', String(expiredRes.status), expiredRes.status === 401);
  const wrongPassword = await call('POST', '/auth/login', undefined, { email: 'planner@wethaq.demo', password: 'wrong-password' });
  const unknownEmail = await call('POST', '/auth/login', undefined, { email: 'nobody@wethaq.demo', password: 'wrong-password' });
  check('Security', 'Wrong password and unknown email give the same answer', '401, same message', `${wrongPassword.status} / ${unknownEmail.status}, ${wrongPassword.body.error === unknownEmail.body.error ? 'same' : 'different'} message`,
    wrongPassword.status === 401 && unknownEmail.status === 401 && wrongPassword.body.error === unknownEmail.body.error);
  const injection = await call('POST', '/auth/login', undefined, { email: "' OR '1'='1' --", password: "' OR '1'='1" });
  check('Security', 'SQL injection in the sign-in form', '400 or 401', String(injection.status), injection.status === 400 || injection.status === 401);

  const forbidden: [string, string, string, string, unknown?][] = [
    ['Planner adds a user', 'planner', 'POST', '/users', { name: 'X', email: 'x@wethaq.demo', role: 'Admin', org: 'System Administration' }],
    ['Dispatcher creates a shipment request', 'dispatcher', 'POST', '/shipments', { partId: 'SP-001', location: 'Central Warehouse', qty: 1, month: '2026-12', note: 'x' }],
    ['Receiver resets a password', 'receiver', 'POST', '/users/USR-001/reset-password'],
    ['Dispatcher changes a role', 'dispatcher', 'PATCH', '/users/USR-001', { role: 'Receiver' }]
  ];
  for (const [label, who, method, route, body] of forbidden) {
    const res = await call(method, route, token[who], body);
    check('Security', label, '403', String(res.status), res.status === 403);
  }
  const target = completed[0];
  const pending = burst.find(r => r.status === 201)?.body.id as string | undefined;
  if (pending) {
    const wrongRole: [string, string, string][] = [['Planner records a dispatch', 'planner', 'dispatch'], ['Receiver records a dispatch', 'receiver', 'dispatch'], ['Dispatcher confirms a receipt', 'dispatcher', 'receive']];
    for (const [label, who, op] of wrongRole) {
      const res = await call('POST', `/shipments/${pending}/${op}`, token[who], { qty: 1, note: 'NFR security test' });
      const ok = res.status === 422 && res.body.passed === false && res.body.source === 'application' && !res.body.txId;
      check('Security', `${label} (refused before the ledger)`, '422, not submitted', `${res.status}, ${res.body.source ?? '—'}${res.body.txId ? ', submitted' : ', not submitted'}`, ok);
    }
  }
  const plannerState = await call('GET', '/state', token.planner);
  check('Security', 'A non-admin sees only their own user record', '1 user', `${plannerState.body.users?.length} user(s)`, plannerState.body.users?.length === 1);
  const me = await call('GET', '/auth/me', token.planner);
  check('Security', 'Password hashes are never returned by the API', 'not present', /passwordHash|password_hash|\$2[aby]\$/.test(JSON.stringify(me.body) + JSON.stringify(plannerState.body)) ? 'present' : 'not present',
    !/passwordHash|password_hash|\$2[aby]\$/.test(JSON.stringify(me.body) + JSON.stringify(plannerState.body)));
  const hashes = (await db.query<{ n: number; hashed: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE password_hash ~ '^\\$2[aby]\\$10\\$')::int AS hashed FROM users`)).rows[0];
  check('Security', 'Passwords stored as bcrypt hashes', 'all users', `${hashes.hashed}/${hashes.n}`, hashes.n > 0 && hashes.hashed === hashes.n);
  const headers = health.headers;
  const secured = ['x-content-type-options', 'content-security-policy', 'strict-transport-security', 'x-frame-options'].filter(h => headers.get(h));
  check('Security', 'Security headers (helmet)', '4 headers', `${secured.length}: ${secured.join(', ')}`, secured.length === 4);

  // ---------- Integrity ----------
  let matching = 0;
  for (const id of completed) if ((await call('GET', `/shipments/${id}/verify`, token.dispatcher)).body.match) matching++;
  check('Integrity', 'Completed shipments match the ledger', `${completed.length}/${completed.length}`, `${matching}/${completed.length}`, completed.length > 0 && matching === completed.length);
  if (target) {
    const before = await call('GET', `/shipments/${target}/verify`, token.dispatcher);
    // Lower the received quantity by one: since migration 004 the database itself refuses a received quantity
    // above the dispatched one, so the simulated tampering stays within the table's constraints.
    await db.query('UPDATE shipments SET received_qty = received_qty - 1 WHERE shipment_id = $1', [target]);
    const tampered = await call('GET', `/shipments/${target}/verify`, token.dispatcher);
    await db.query('UPDATE shipments SET received_qty = received_qty + 1 WHERE shipment_id = $1', [target]);
    const restored = await call('GET', `/shipments/${target}/verify`, token.dispatcher);
    check('Integrity', 'A change made directly in PostgreSQL is detected', 'mismatch reported', tampered.body.match ? 'not detected' : `detected: ${tampered.body.differences?.join('; ')}`, before.body.match && !tampered.body.match && restored.body.match);

    const duplicate = await call('POST', `/shipments/${target}/receive`, token.receiver, { qty: 1, note: 'NFR integrity test' });
    const after = await call('GET', `/shipments/${target}/verify`, token.dispatcher);
    const oldHistory = JSON.stringify(before.body.history);
    const kept = JSON.stringify(after.body.history?.slice(0, before.body.history.length)) === oldHistory;
    const added = after.body.history?.length - before.body.history?.length;
    check('Integrity', 'A second receipt is refused by the smart contract', 'noDuplicate', `${duplicate.status}, ${duplicate.body.failedRule} (${duplicate.body.source}, block ${duplicate.body.block ?? '—'})`, duplicate.status === 422 && duplicate.body.failedRule === 'noDuplicate' && duplicate.body.source === 'chaincode');
    check('Integrity', 'Earlier ledger records are unchanged; the attempt is appended', 'unchanged, +1 record', `${kept ? 'unchanged' : 'CHANGED'}, +${added} record`, kept && added === 1);
    check('Integrity', 'The shipment state is unchanged after the rejected attempt', 'unchanged', JSON.stringify(after.body.ledger) === JSON.stringify(before.body.ledger) ? 'unchanged' : 'changed', JSON.stringify(after.body.ledger) === JSON.stringify(before.body.ledger));
  }

  // ---------- Reliability: the five smart-contract rules ----------
  const scenarios: Record<string, string> = {
    'Duplicate receipt': 'noDuplicate', 'Unauthorized organization': 'authorizedOrg', 'Invalid status transition': 'validTransition',
    'Quantity exceeds dispatched': 'validQuantity', 'Unknown shipment reference': 'validReference'
  };
  if (pending) await call('POST', `/shipments/${pending}/dispatch`, token.dispatcher, { qty: 1, note: 'NFR reliability test' });
  for (const [scenario, rule] of Object.entries(scenarios)) {
    const res = time('Rejected operation (ledger)', await call('POST', '/demo/invalid', token.admin, { scenario }));
    check('Reliability', `Rule ${rule}: ${scenario}`, `rejected by ${rule}`, res.status === 422 ? `rejected by ${res.body.failedRule} (${res.body.source})` : `${res.status} ${res.body.error ?? ''}`, res.status === 422 && res.body.failedRule === rule && res.body.source === 'chaincode');
  }

  await report(ledgerKind, perf, burstSeconds, burstOk);
}

async function report(ledgerKind: string, perf: ({ action: string } & ReturnType<typeof stats>)[], burstSeconds: number, burstOk: number) {
  const passed = checks.filter(c => c.passed).length;
  const when = new Date();
  const dir = path.resolve('nfr-results');
  await mkdir(dir, { recursive: true });
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const md = [
    `# Wethaq NFR measurements`,
    ``,
    `Measured ${when.toISOString()} against ${API} with the ${ledgerKind === 'fabric' ? 'Hyperledger Fabric test network (2 organizations, 1 orderer, endorsement by both organizations)' : 'local development ledger (not Fabric)'}.`,
    `${RUNS} workflow runs one at a time, then ${CONCURRENCY} requests at once. Target response time: ${TARGET_MS} ms.`,
    `Node ${process.version} on ${process.platform}/${process.arch}.`,
    ``,
    `Result: ${passed} of ${checks.length} checks passed.`,
    ``,
    `## Response times`,
    ``,
    `| Action | Runs | Average | Median | 95th percentile | Max |`,
    `|---|---|---|---|---|---|`,
    ...perf.map(p => `| ${p.action} | ${p.n} | ${ms(p.avg)} | ${ms(p.p50)} | ${ms(p.p95)} | ${ms(p.max)} |`),
    ``,
    `Throughput: ${burstOk} of ${CONCURRENCY} concurrent requests committed in ${burstSeconds.toFixed(2)} s (${(burstOk / burstSeconds).toFixed(1)} transactions per second).`,
    ledgerKind === 'fabric' ? `\nNote: a ledger write returns once its block is committed. The orderer cuts a block after its BatchTimeout (500 ms in fabric/up.sh; the sample network's default is 2 s) or as soon as 10 transactions are waiting, so a single write waits for the timeout while concurrent writes share blocks.` : '',
    ``,
    `## Checks`,
    ``,
    `| Quality attribute | Test | Expected | Observed | Result |`,
    `|---|---|---|---|---|`,
    ...checks.map(c => `| ${c.area} | ${c.test} | ${c.expected} | ${c.observed.replace(/\|/g, '/')} | ${c.passed ? 'Pass' : 'Fail'} |`),
    ``
  ].join('\n');
  await writeFile(path.join(dir, `nfr-${stamp}.md`), md);
  await writeFile(path.join(dir, `nfr-${stamp}.json`), JSON.stringify({ measuredAt: when, api: API, ledger: ledgerKind, runs: RUNS, concurrency: CONCURRENCY, targetMs: TARGET_MS, performance: perf, throughput: { committed: burstOk, seconds: burstSeconds }, checks }, null, 2));
  console.log(`\n${passed} of ${checks.length} checks passed. Report: nfr-results/nfr-${stamp}.md`);
  // A failed check must fail the command (and the CI step that runs it).
  if (passed < checks.length) process.exitCode = 1;
}

try { await main(); } finally { await db.close(); }
