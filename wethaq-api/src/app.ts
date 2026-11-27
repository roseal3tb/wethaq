import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Ledger } from './ledger/types.js';
import { checkPassword, findUser, publicUser, requireAuth, requireRole, ROLES, signToken, temporaryPasswordExpired, type AuthedRequest, type Role } from './auth.js';
import { EventBus, type LiveEvent } from './events.js';
import { HttpError } from './services/common.js';
import { createShipment, invalidDemo, operate, verifyShipment } from './services/shipments.js';
import { loadInventory, loadState } from './services/state.js';
import { addUser, changePassword, resetPassword, updateUser } from './services/users.js';

/** The seeded account that /auth/switch signs in as for each demonstration role. */
export const DEMO_ACCOUNTS: Record<Role, string> = {
  Planner: 'planner@wethaq.demo', Dispatcher: 'dispatcher@wethaq.demo', Receiver: 'receiver@wethaq.demo', Admin: 'admin@wethaq.demo'
};

export function createApp({ db, ledger, config, bus = new EventBus() }: { db: Db; ledger: Ledger; config: Pick<Config, 'jwtSecret' | 'jwtTtl' | 'demoRoleSwitch' | 'corsOrigin'> & Partial<Pick<Config, 'tempPasswordHours'>>; bus?: EventBus }) {
  const app = express();
  const tempHours = config.tempPasswordHours ?? 24;
  // Every transaction committed on the ledger, by this API or by any other client of the network.
  const stopLedgerEvents = ledger.onCommit(e => bus.emit({
    kind: 'ledger', name: e.name, txId: e.txId, block: e.block, shipmentId: e.record.shipmentId,
    status: e.record.status === 'Rejected' ? 'Rejected' : e.record.toStatus, operation: e.record.operation
  }));
  /** Signals that the PostgreSQL copy changed, so open dashboards reload it. */
  const changed = (name: string, shipmentId?: string) => bus.emit({ kind: 'app', name, shipmentId });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  if (config.corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin!);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  api.get('/health', wrap(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, ledger: ledger.kind });
  }));

  api.post('/auth/login', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts — wait a minute and try again' } }), wrap(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw new HttpError(400, 'Email and password are required');
    const user = await findUser(db, 'email', email.trim());
    // Compare even when the user is unknown, so response time does not reveal which emails exist.
    const ok = await checkPassword(password, user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    if (!user || !ok) throw new HttpError(401, 'Incorrect email or password');
    if (!user.active) throw new HttpError(401, 'This account has been deactivated');
    if (temporaryPasswordExpired(user)) throw new HttpError(401, 'Your temporary password has expired — ask an administrator to issue a new one');
    await db.query('UPDATE users SET last_seen = now() WHERE user_id = $1', [user.id]);
    res.json(session(user));
  }));

  api.post('/auth/password', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — wait a minute and try again' } }), authPending, wrap(async (req, res) => {
    const updated = await changePassword(db, req.user!, req.body ?? {});
    changed('UserUpdated');
    res.json(session(updated));
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

  api.get('/state', auth, wrap(async (req, res) => res.json(await loadState(db, req.user!))));
  api.get('/inventory', auth, wrap(async (_req, res) => res.json(await loadInventory(db))));

  api.post('/shipments', auth, requireRole('request'), wrap(async (req, res) => {
    const { partId, location, qty, month, note } = req.body ?? {};
    const created = await createShipment(db, ledger, req.user!, { partId, location, qty, month, note });
    changed('ShipmentRequested', created.id);
    res.status(201).json(created);
  }));

  for (const op of ['dispatch', 'transit', 'receive'] as const) {
    api.post(`/shipments/:id/${op}`, auth, wrap(async (req, res) => {
      const result = await operate(db, ledger, req.user!, op, req.params.id, req.body?.qty, req.body?.note);
      changed(result.passed ? 'ShipmentUpdated' : 'OperationRejected', req.params.id);
      res.status(result.passed ? 200 : 422).json(result);
    }));
  }

  api.get('/shipments/:id/verify', auth, wrap(async (req, res) => res.json(await verifyShipment(db, ledger, req.params.id))));

  api.post('/demo/invalid', auth, requireRole('demo'), wrap(async (req, res) => {
    const result = await invalidDemo(db, ledger, req.user!, req.body?.scenario, typeof req.body?.shipmentId === 'string' ? req.body.shipmentId : undefined);
    changed('OperationRejected');
    res.status(result.passed ? 200 : 422).json(result);
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
    changed('UserUpdated');
    res.status(201).json(created);
  }));
  api.patch('/users/:id', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const updated = await updateUser(db, req.user!, req.params.id, req.body ?? {});
    changed('UserUpdated');
    res.json(updated);
  }));
  api.post('/users/:id/reset-password', auth, requireRole('manageUsers'), wrap(async (req, res) => {
    const updated = await resetPassword(db, req.user!, req.params.id, tempHours);
    changed('UserUpdated');
    res.json(updated);
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return Object.assign(app, { stopLedgerEvents });
}
