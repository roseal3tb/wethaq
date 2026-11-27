import { randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { checkPassword, findUser, hashPassword, passwordProblem, publicUser, ROLE_ORG, ROLES, type ApiUser, type Role } from '../auth.js';
import { HttpError } from './common.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function orgIdByName(db: Db, name: string) {
  const row = (await db.query<{ org_id: string }>('SELECT org_id FROM organizations WHERE name = $1', [name])).rows[0];
  if (!row) throw new HttpError(400, `Unknown organization "${name}"`);
  return row.org_id;
}
const roleId = (role: Role) => `ROLE-${role.toUpperCase()}`;

const temporary = () => randomBytes(9).toString('base64url');

/**
 * Creates an account with a one-time temporary password, which is returned once and never stored in plain text.
 * The user must replace it at first sign-in, and it stops working after `hours` hours.
 */
export async function addUser(db: Db, input: { name?: unknown; email?: unknown; role?: unknown; org?: unknown }, hours = 24) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const role = input.role as Role;
  if (!name || name.length > 120) throw new HttpError(400, 'A name of up to 120 characters is required');
  if (!EMAIL.test(email) || email.length > 200) throw new HttpError(400, 'A valid email address is required');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  const org = await orgIdByName(db, typeof input.org === 'string' ? input.org : '');
  if (await findUser(db, 'email', email)) throw new HttpError(409, 'A user with this email already exists');
  const temporaryPassword = temporary();
  const id = await db.transaction(async q => {
    const last = (await q.query<{ n: number | null }>(`SELECT max(split_part(user_id, '-', 2)::int) AS n FROM users WHERE user_id ~ '^USR-\\d+$'`)).rows[0].n ?? 0;
    const newId = `USR-${String(last + 1).padStart(3, '0')}`;
    await q.query(
      `INSERT INTO users (user_id, name, email, password_hash, role_id, org_id, must_change_password, password_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, now() + make_interval(secs => $7))`,
      [newId, name, email, await hashPassword(temporaryPassword), roleId(role), org, hours * 3600]
    );
    return newId;
  });
  return { ...publicUser((await findUser(db, 'id', id))!), temporaryPassword };
}

export async function updateUser(db: Db, actor: ApiUser, id: string, changes: { role?: unknown; active?: unknown }) {
  const target = await findUser(db, 'id', id);
  if (!target) throw new HttpError(404, 'User not found');
  if (changes.role !== undefined && !ROLES.includes(changes.role as Role)) throw new HttpError(400, 'Invalid role');
  if (changes.active !== undefined && typeof changes.active !== 'boolean') throw new HttpError(400, 'active must be true or false');
  if (target.id === actor.id && (changes.active === false || (changes.role && changes.role !== 'Admin'))) throw new HttpError(400, 'You cannot deactivate or demote your own account');
  // A role belongs to one organization (Dispatcher → Org1, Receiver → Org2), so the organization follows the role.
  if (changes.role !== undefined) await db.query('UPDATE users SET role_id = $2, org_id = $3 WHERE user_id = $1', [id, roleId(changes.role as Role), await orgIdByName(db, ROLE_ORG[changes.role as Role])]);
  if (changes.active !== undefined) await db.query('UPDATE users SET active = $2 WHERE user_id = $1', [id, changes.active]);
  return publicUser((await findUser(db, 'id', id))!);
}

/** Issues a new temporary password for another user (Admin). Existing sessions of that user stop working until it is changed. */
export async function resetPassword(db: Db, actor: ApiUser, id: string, hours = 24) {
  const target = await findUser(db, 'id', id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.id === actor.id) throw new HttpError(400, 'Use Change password to change your own password');
  const temporaryPassword = temporary();
  await db.query(
    'UPDATE users SET password_hash = $2, must_change_password = TRUE, password_expires_at = now() + make_interval(secs => $3) WHERE user_id = $1',
    [id, await hashPassword(temporaryPassword), hours * 3600]
  );
  return { ...publicUser((await findUser(db, 'id', id))!), temporaryPassword };
}

/** Lets a signed-in user replace their password (and a temporary password at first sign-in). */
export async function changePassword(db: Db, user: ApiUser, input: { currentPassword?: unknown; newPassword?: unknown }) {
  const { currentPassword, newPassword } = input;
  if (typeof currentPassword !== 'string' || !currentPassword) throw new HttpError(400, 'Enter your current password');
  const problem = passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);
  const stored = await findUser(db, 'id', user.id);
  if (!stored || !(await checkPassword(currentPassword, stored.passwordHash))) throw new HttpError(400, 'The current password is incorrect');
  if (await checkPassword(newPassword as string, stored.passwordHash)) throw new HttpError(400, 'The new password must be different from the current password');
  await db.query(
    'UPDATE users SET password_hash = $2, must_change_password = FALSE, password_expires_at = NULL, password_changed_at = now() WHERE user_id = $1',
    [user.id, await hashPassword(newPassword as string)]
  );
  return (await findUser(db, 'id', user.id))!;
}
