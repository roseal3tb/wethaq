import type { Queryable } from '../db.js';
import { logger } from '../logger.js';

export interface AuditEntry {
  action: string;
  outcome: 'ok' | 'denied' | 'rejected' | 'failed' | 'pending';
  userId?: string | null; org?: string | null; target?: string | null; requestId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Writes one row to the application audit log. The detail must never contain passwords, tokens or keys
 * (the logger redacts them, and callers only pass identifiers and messages). Audit failures are logged
 * but never break the request that is being audited.
 */
export async function audit(q: Queryable, e: AuditEntry) {
  try {
    await q.query('INSERT INTO audit_log (request_id, user_id, org, action, target, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [e.requestId ?? null, e.userId ?? null, e.org ?? null, e.action, e.target ?? null, e.outcome, JSON.stringify(e.detail ?? {})]);
  } catch (err) {
    logger.error('audit_write_failed', { action: e.action, error: String(err) });
  }
}
