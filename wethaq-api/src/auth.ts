import { randomUUID } from 'node:crypto';
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

export interface ApiUser {
  id: string; name: string; email: string; role: Role; org: string; mspId: string | null; active: boolean; lastSeen: string;
  /** true while the account still uses a temporary password issued by an administrator */
  mustChangePassword: boolean;
  /** when the temporary password stops working (null once the user has chosen a password) */
  passwordExpiresAt: string | null;
  /** Increased by a password change or reset; tokens with an older version are refused. */
  sessionVersion?: number;
}
export interface AuthedRequest extends Request { user?: ApiUser; session?: { jti: string | null; expiresAt: Date | null }; }

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const USER_SELECT = `SELECT u.user_id AS id, u.name, u.email, r.name AS role, o.name AS org, o.msp_id AS "mspId", u.active, u.last_seen AS "lastSeen", u.password_hash AS "passwordHash",
  u.must_change_password AS "mustChangePassword", u.password_expires_at AS "passwordExpiresAt", u.session_version AS "sessionVersion"
  FROM users u JOIN roles r ON r.role_id = u.role_id JOIN organizations o ON o.org_id = u.org_id`;

export async function findUser(q: Queryable, where: 'id' | 'email', value: string) {
  const column = where === 'id' ? 'u.user_id' : 'lower(u.email)';
  const row = (await q.query<ApiUser & { passwordHash: string; lastSeen: Date | string; passwordExpiresAt: Date | string | null }>(`${USER_SELECT} WHERE ${column} = $1`, [where === 'email' ? value.toLowerCase() : value])).rows[0];
  return row ? { ...row, lastSeen: new Date(row.lastSeen).toISOString(), passwordExpiresAt: row.passwordExpiresAt ? new Date(row.passwordExpiresAt).toISOString() : null } : undefined;
}

/** Public shape of a user, as the dashboard's LiveUser type expects. */
export const publicUser = ({ id, name, email, role, org, active, lastSeen, mustChangePassword, passwordExpiresAt }: ApiUser) => ({ id, name, email, role, org, active, lastSeen, mustChangePassword, passwordExpiresAt });

/** A temporary password that has passed its expiry time no longer signs in. */
export const temporaryPasswordExpired = (user: Pick<ApiUser, 'mustChangePassword' | 'passwordExpiresAt'>, now = Date.now()) =>
  user.mustChangePassword && !!user.passwordExpiresAt && new Date(user.passwordExpiresAt).getTime() <= now;

/** Password policy for passwords that users choose: 8 to 128 characters with at least one letter and one digit. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'The new password must be 8 to 128 characters long';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'The new password must contain at least one letter and one digit';
  return null;
}

export function signToken(user: ApiUser, secret: string, ttl: string) {
  return jwt.sign({ sub: user.id, role: user.role, sv: user.sessionVersion ?? 0, jti: randomUUID() }, secret, { expiresIn: ttl as jwt.SignOptions['expiresIn'], algorithm: 'HS256' });
}

/**
 * Verifies the bearer token and loads the current user; inactive users, and tokens from a session that has
 * ended (sign-out, password change or reset), are refused.
 * An account that still has a temporary password may only reach the routes that let it change it
 * (allowPendingPassword), and is signed out once the temporary password expires.
 */
export function requireAuth(db: Queryable, secret: string, { allowPendingPassword = false } = {}) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    let sub: string; let version: number; let jti: string | null; let exp: number | undefined;
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      sub = String(payload.sub); version = Number(payload.sv ?? 0); jti = typeof payload.jti === 'string' ? payload.jti : null; exp = payload.exp;
    } catch { return res.status(401).json({ error: 'Session expired — sign in again' }); }
    try {
      const user = await findUser(db, 'id', sub);
      if (!user || !user.active) return res.status(401).json({ error: 'Account is not active' });
      // The password was changed or reset after this token was issued, or the user signed out with it.
      if (version !== (user.sessionVersion ?? 0)) return res.status(401).json({ error: 'This session has ended — sign in again' });
      if (jti && (await db.query('SELECT 1 FROM revoked_tokens WHERE jti = $1', [jti])).rows.length) return res.status(401).json({ error: 'You have signed out — sign in again' });
      req.session = { jti, expiresAt: exp ? new Date(exp * 1000) : null };
      if (temporaryPasswordExpired(user)) return res.status(401).json({ error: 'Your temporary password has expired — ask an administrator to issue a new one' });
      if (user.mustChangePassword && !allowPendingPassword) return res.status(403).json({ error: 'Change your temporary password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
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
