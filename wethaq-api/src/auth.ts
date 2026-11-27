import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { Queryable } from './db.js';

export type Role = 'Planner' | 'Dispatcher' | 'Receiver' | 'Admin';
export const ROLES: Role[] = ['Planner', 'Dispatcher', 'Receiver', 'Admin'];

/** User-level permissions, checked by the API before anything is submitted to the ledger (Section 4.3.6). */
export const PERMISSIONS = {
  request: ['Planner'], dispatch: ['Dispatcher'], transit: ['Dispatcher'], receive: ['Receiver'],
  manageUsers: ['Admin'], ack: ROLES, demo: ROLES
} satisfies Record<string, Role[]>;
export type Action = keyof typeof PERMISSIONS;
export const allowed = (role: Role, action: Action) => (PERMISSIONS[action] as Role[]).includes(role);

/** The default organization for each role, and the Fabric MSP it submits through. */
export const ROLE_ORG: Record<Role, string> = {
  Planner: 'Logistics Command', Dispatcher: 'Org1 (Issuing)', Receiver: 'Org2 (Receiving)', Admin: 'System Administration'
};

export interface ApiUser { id: string; name: string; email: string; role: Role; org: string; mspId: string | null; active: boolean; lastSeen: string; }
export interface AuthedRequest extends Request { user?: ApiUser; }

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const USER_SELECT = `SELECT u.user_id AS id, u.name, u.email, r.name AS role, o.name AS org, o.msp_id AS "mspId", u.active, u.last_seen AS "lastSeen", u.password_hash AS "passwordHash"
  FROM users u JOIN roles r ON r.role_id = u.role_id JOIN organizations o ON o.org_id = u.org_id`;

export async function findUser(q: Queryable, where: 'id' | 'email', value: string) {
  const column = where === 'id' ? 'u.user_id' : 'lower(u.email)';
  const row = (await q.query<ApiUser & { passwordHash: string; lastSeen: Date | string }>(`${USER_SELECT} WHERE ${column} = $1`, [where === 'email' ? value.toLowerCase() : value])).rows[0];
  return row ? { ...row, lastSeen: new Date(row.lastSeen).toISOString() } : undefined;
}

/** Public shape of a user, as the dashboard's LiveUser type expects. */
export const publicUser = ({ id, name, email, role, org, active, lastSeen }: ApiUser) => ({ id, name, email, role, org, active, lastSeen });

export function signToken(user: ApiUser, secret: string, ttl: string) {
  return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: ttl as jwt.SignOptions['expiresIn'], algorithm: 'HS256' });
}

/** Verifies the bearer token and loads the current user; inactive users are refused. */
export function requireAuth(db: Queryable, secret: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    let sub: string;
    try { sub = String((jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload).sub); }
    catch { return res.status(401).json({ error: 'Session expired — sign in again' }); }
    try {
      const user = await findUser(db, 'id', sub);
      if (!user || !user.active) return res.status(401).json({ error: 'Account is not active' });
      req.user = user;
      next();
    } catch (err) { next(err); }
  };
}

export function requireRole(action: Action) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed(req.user.role, action)) return res.status(403).json({ error: `Your role (${req.user?.role ?? 'none'}) is not permitted to perform this action` });
    next();
  };
}
