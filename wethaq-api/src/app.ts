import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Config } from './config.js';
import { isDatabaseUnavailable, type Db } from './db.js';
import type { Ledger } from './ledger/types.js';
import { checkPassword, findUser, publicUser, requireAuth, requireRole, ROLES, signToken, temporaryPasswordExpired, type AuthedRequest, type Role } from './auth.js';
import { EventBus, type LiveEvent } from './events.js';
import { logger } from './logger.js';
import { audit } from './services/audit.js';
import { HttpError } from './services/common.js';
import { inventoryPositions } from './services/inventory.js';
import { startSync } from './services/operations.js';
import { createShipment, idempotencyKey, invalidDemo, operate, verifyShipment, type RequestContext } from './services/shipments.js';
import { loadState } from './services/state.js';
import { listAlerts, listAudit, listLedgerRecords, listShipments, shipmentTrace } from './services/lists.js';
import { consistencyReport } from './services/consistency.js';
import { analyticsRouter, analyticsV1Router } from './services/analytics.js';
import { addUser, changePassword, resetPassword, updateUser } from './services/users.js';

/** The seeded account that /auth/switch signs in as for each demonstration role. */
export const DEMO_ACCOUNTS: Record<Role, string> = {
  Planner: 'planner@wethaq.demo', Dispatcher: 'dispatcher@wethaq.demo', Receiver: 'receiver@wethaq.demo', Admin: 'admin@wethaq.demo'
};

export type AppConfig = Pick<Config, 'jwtSecret' | 'jwtTtl' | 'demoRoleSwitch' | 'corsOrigin'>
  & Partial<Pick<Config, 'tempPasswordHours' | 'demoTools' | 'production' | 'reconcileIntervalMs' | 'pendingExpiryMs'>>
  & { /** Delay before the event consumer subscribes again after an event could not be applied (tests shorten it). */ resyncDelayMs?: number };

export function createApp({ db, ledger, config, bus = new EventBus() }: { db: Db; ledger: Ledger; config: AppConfig; bus?: EventBus }) {
  const app = express();
  const tempHours = config.tempPasswordHours ?? 24;
  const demoTools = config.demoTools ?? config.demoRoleSwitch;
  // Every transaction committed on the ledger, by this API or by any other client of the network, is applied
  // to PostgreSQL once (from a stored checkpoint) and announced to open dashboards; unknown outcomes are reconciled.
  const sync = startSync({ db, ledger, bus, intervalMs: config.reconcileIntervalMs ?? 0, pendingExpiryMs: config.pendingExpiryMs ?? 5 * 60_000, resyncDelayMs: config.resyncDelayMs });
  const stopLedgerEvents = () => { void sync.stop(); };
  /** Signals that the PostgreSQL copy changed, so open dashboards reload it. */
  const changed = (name: string, shipmentId?: string) => bus.emit({ kind: 'app', name, shipmentId });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  // A request id for the logs and the audit log (a valid incoming X-Request-Id is kept).
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as AuthedRequest & { requestId?: string }).requestId = id;
    res.setHeader('X-Request-Id', id);
    const started = Date.now();
    res.on('finish', () => logger.info('http', { requestId: id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }));
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  if (config.corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin!);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Request-Id');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }
  const api = express.Router();
  const auth = requireAuth(db, config.jwtSecret);
  /** For the routes an account with a temporary password may use: who am I, and change my password. */
  const authPending = requireAuth(db, config.jwtSecret, { allowPendingPassword: true });
  const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);
  const session = (user: Awaited<ReturnType<typeof findUser>> & {}) => ({ token: signToken(user, config.jwtSecret, config.jwtTtl), user: publicUser(user), demoRoleSwitch: config.demoRoleSwitch, ledger: ledger.kind });

  const ctx = (req: AuthedRequest): RequestContext => ({ idempotencyKey: idempotencyKey(req.get('idempotency-key')), requestId: (req as { requestId?: string }).requestId });
  const send = (res: Response, r: { status: number; body: Record<string, unknown> }) => res.status(r.status).json(r.body);

  api.get('/health', wrap(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, ledger: ledger.kind });
  }));
  const openapi = JSON.parse(readFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), 'utf8'));
  api.get('/openapi.json', (_req, res) => res.json(openapi));
  /** Liveness: the process is running. */
  api.get('/health/live', (_req, res) => res.json({ ok: true }));
  /** Readiness: the database and the ledger can both be used. 503 when either cannot. */
  api.get('/health/ready', wrap(async (_req, res) => {
    const database = await db.query('SELECT 1').then(() => ({ ok: true, detail: 'PostgreSQL reachable' }), err => ({ ok: false, detail: `PostgreSQL: ${String(err).slice(0, 200)}` }));
    const ledgerHealth = await ledger.health().catch(err => ({ ok: false, detail: String(err).slice(0, 200) }));
    const ok = database.ok && ledgerHealth.ok;
    res.status(ok ? 200 : 503).json({ ok, ledger: ledger.kind, database, ledgerHealth });
  }));

  api.post('/auth/login', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts — wait a minute and try again' } }), wrap(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw new HttpError(400, 'Email and password are required');
    const user = await findUser(db, 'email', email.trim());
    // Compare even when the user is unknown, so response time does not reveal which emails exist.
    const ok = await checkPassword(password, user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    if (!user || !ok) {
      await audit(db, { action: 'auth.login', outcome: 'denied', userId: user?.id, requestId: (req as { requestId?: string }).requestId, detail: { reason: 'bad credentials' } });
      throw new HttpError(401, 'Incorrect email or password');
    }
    if (!user.active) throw new HttpError(401, 'This account has been deactivated');
    if (temporaryPasswordExpired(user)) throw new HttpError(401, 'Your temporary password has expired — ask an administrator to issue a new one');
    await db.query('UPDATE users SET last_seen = now() WHERE user_id = $1', [user.id]);
    await audit(db, { action: 'auth.login', outcome: 'ok', userId: user.id, org: user.org, requestId: (req as { requestId?: string }).requestId });
    res.json(session(user));
  }));

  api.post('/auth/password', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — wait a minute and try again' } }), authPending, wrap(async (req, res) => {
    const updated = await changePassword(db, req.user!, req.body ?? {});
    await audit(db, { action: 'auth.password_change', outcome: 'ok', userId: req.user!.id, requestId: (req as { requestId?: string }).requestId });
    changed('UserUpdated');
    res.json(session(updated));
  }));

  /** Signs out: the token used for this request is refused from now on (other devices stay signed in). */
  api.post('/auth/logout', authPending, wrap(async (req, res) => {
    const { jti, expiresAt } = req.session ?? { jti: null, expiresAt: null };
    if (jti) {
      await db.query('DELETE FROM revoked_tokens WHERE expires_at < now()');
      await db.query('INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING', [jti, req.user!.id, expiresAt ?? new Date(Date.now() + 86_400_000)]);
    }
    await audit(db, { action: 'auth.logout', outcome: 'ok', userId: req.user!.id, org: req.user!.org, requestId: (req as { requestId?: string }).requestId });
    res.json({ ok: true });
  }));

  /** Server-sent events: live ledger and database changes for open dashboards (read with fetch, so the token stays in the Authorization header). */
  api.get('/events', auth, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: ready\ndata: ${JSON.stringify({ ledger: ledger.kind })}\n\n`);
    const send = (event: LiveEvent) => res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = bus.subscribe(send);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });

  api.get('/auth/me', authPending, wrap(async (req, res) => res.json({ user: publicUser(req.user!), demoRoleSwitch: config.demoRoleSwitch, ledger: ledger.kind })));

  api.post('/auth/switch', auth, wrap(async (req, res) => {
    if (!config.demoRoleSwitch) throw new HttpError(403, 'Role switching is disabled on this server');
    const role = req.body?.role as Role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    const target = await findUser(db, 'email', DEMO_ACCOUNTS[role]);
    if (!target || !target.active) throw new HttpError(409, `The demonstration ${role} account is not available`);
    res.json(session(target));
  }));

  api.get('/state', auth, wrap(async (req, res) => res.json({ ...(await loadState(db, req.user!)), inventory: await inventoryPositions(db) })));
  /** Inventory positions computed from the stock levels in PostgreSQL, with stock already in transit. */
  api.get('/inventory', auth, wrap(async (req, res) => {
    const partId = typeof req.query.partId === 'string' ? req.query.partId : undefined;
    const location = typeof req.query.location === 'string' ? req.query.location : undefined;
    res.json(await inventoryPositions(db, { partId, location }));
  }));
  api.use('/analytics/v1', auth, analyticsV1Router());
  api.use('/analytics', auth, analyticsRouter());

  api.post('/shipments', auth, requireRole('request'), wrap(async (req, res) => {
    const { partId, location, qty, month, note } = req.body ?? {};
    const result = await createShipment(db, ledger, req.user!, { partId, location, qty, month, note }, undefined, ctx(req));
    changed(result.status === 202 ? 'ShipmentPending' : 'ShipmentRequested', result.body.id as string);
    send(res, result);
  }));

  // Paths for the operations; the version 2 ones (GP2, B5) are receive-partial, cancel and return.
  const OPERATION_PATHS = { dispatch: 'dispatch', transit: 'transit', receive: 'receive', receivePartial: 'receive-partial', cancel: 'cancel', return: 'return' } as const;
  for (const [op, path] of Object.entries(OPERATION_PATHS) as [keyof typeof OPERATION_PATHS, string][]) {
    api.post(`/shipments/:id/${path}`, auth, wrap(async (req, res) => {
      const result = await operate(db, ledger, req.user!, op, req.params.id, req.body?.qty, req.body?.note, {}, ctx(req));
      changed(result.status === 200 ? 'ShipmentUpdated' : result.status === 202 ? 'OperationPending' : 'OperationRejected', req.params.id);
      send(res, result);
    }));
  }

  /** Paginated, filtered lists of the reporting copy (/state returns everything at once for the dashboard). */
  api.get('/shipments', auth, wrap(async (req, res) => res.json(await listShipments(db, req.query))));
  api.get('/shipments/:id', auth, wrap(async (req, res) => res.json(await shipmentTrace(db, ledger, req.params.id, req.query))));
  api.get('/ledger/records', auth, wrap(async (req, res) => res.json(await listLedgerRecords(db, req.query))));
  api.get('/alerts', auth, wrap(async (req, res) => res.json(await listAlerts(db, req.query))));

  api.get('/shipments/:id/verify', auth, wrap(async (req, res) => res.json(await verifyShipment(db, ledger, req.params.id))));

  api.post('/demo/invalid', auth, requireRole('demo'), wrap(async (req, res) => {
    if (!demoTools) throw new HttpError(403, 'Demonstration tools are disabled on this server');
    const result = await invalidDemo(db, ledger, req.user!, req.body?.scenario, typeof req.body?.shipmentId === 'string' ? req.body.shipmentId : undefined);
    changed('OperationRejected');
    send(res, result);
  }));

  /** Synchronization between the ledger and PostgreSQL (administrators). */
  api.get('/admin/sync-status', auth, requireRole('manageUsers'), wrap(async (_req, res) => res.json(await sync.status())));
  api.post('/admin/reconcile', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const report = await sync.reconcile();
    await audit(db, { action: 'ledger.reconcile', outcome: 'ok', userId: req.user!.id, requestId: (req as { requestId?: string }).requestId, detail: { ...report, errors: report.errors.length } });
    res.json(report);
  }));
  api.get('/admin/audit', auth, requireRole('manageUsers'), wrap(async (req, res) => res.json(await listAudit(db, req.query))));
  /** Compares every shipment in PostgreSQL with the ledger, and the event checkpoint with the ledger height. Read-only. */
  api.get('/admin/consistency', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const report = await consistencyReport(db, ledger);
    await audit(db, { action: 'ledger.consistency_check', outcome: 'ok', userId: req.user!.id, requestId: (req as { requestId?: string }).requestId, detail: { consistent: report.consistent, ...report.summary, ledgerHeight: report.ledgerHeight } });
    res.json(report);
  }));

  api.post('/alerts/:id/ack', auth, requireRole('ack'), wrap(async (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : null;
    const updated = await db.query('UPDATE alerts SET acknowledged = TRUE, acknowledged_by = $2, resolution_note = COALESCE($3, resolution_note) WHERE alert_id = $1 RETURNING alert_id', [req.params.id, req.user!.id, note || null]);
    if (!updated.rows.length) throw new HttpError(404, 'Alert not found');
    changed('AlertAcknowledged');
    res.json({ ok: true });
  }));

  api.post('/users', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const created = await addUser(db, req.body ?? {}, tempHours);
    await audit(db, { action: 'user.create', outcome: 'ok', userId: req.user!.id, target: (created as { user?: { id?: string } }).user?.id ?? null });
    changed('UserUpdated');
    res.status(201).json(created);
  }));
  api.patch('/users/:id', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const updated = await updateUser(db, req.user!, req.params.id, req.body ?? {});
    await audit(db, { action: 'user.update', outcome: 'ok', userId: req.user!.id, target: req.params.id, detail: { fields: Object.keys(req.body ?? {}) } });
    changed('UserUpdated');
    res.json(updated);
  }));
  api.post('/users/:id/reset-password', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const updated = await resetPassword(db, req.user!, req.params.id, tempHours);
    await audit(db, { action: 'user.reset_password', outcome: 'ok', userId: req.user!.id, target: req.params.id });
    changed('UserUpdated');
    res.json(updated);
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      const extra = err as HttpError & { ledgerFailure?: string; txId?: string };
      return res.status(err.status).json({ error: err.message, ...(extra.ledgerFailure ? { ledgerFailure: extra.ledgerFailure, ledgerState: 'failed', txId: extra.txId } : {}) });
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if (isDatabaseUnavailable(err)) {
      logger.error('database_unavailable', { requestId: (_req as { requestId?: string }).requestId, error: String(err) });
      return res.status(503).json({ error: 'The database is not reachable; try again shortly.' });
    }
    logger.error('unhandled_error', { requestId: (_req as { requestId?: string }).requestId, error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  });
  return Object.assign(app, { stopLedgerEvents, sync });
}
