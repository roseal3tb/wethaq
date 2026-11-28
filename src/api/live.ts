/**
 * Live data access for the Wethaq API (Express + PostgreSQL + Hyperledger Fabric Gateway).
 * Enabled when the dashboard is started with VITE_WETHAQ_LIVE=true (npm run dev:live).
 * Vite proxies /api to the local API service (see vite.config.ts).
 */
import type { AppData, Role, DemoUser, Inventory, Operation } from '../types';

/** API paths of the ledger operations (wethaq-api/src/app.ts). */
const OPERATION_PATH: Record<Operation, string> = { dispatch: 'dispatch', transit: 'transit', receive: 'receive', receivePartial: 'receive-partial', cancel: 'cancel', return: 'return' };

export const LIVE = import.meta.env.VITE_WETHAQ_LIVE === 'true';
/**
 * Where the Wethaq API is. Empty (the default): the same origin, through the Vite proxy in development or a
 * rewrite on the host. A full origin such as https://api.example.edu when the API is on another host; the API
 * must then allow the dashboard's origin (CORS_ORIGIN). See docs/gp482/DEPLOYMENT_GUIDE.md.
 */
const API_BASE = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

const TOKEN_KEY = 'wethaq.token';
export const session = {
  get(): string | null { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(value: string) { try { sessionStorage.setItem(TOKEN_KEY, value); } catch { /* storage unavailable */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } }
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface LiveUser {
  id: string; name: string; email: string; role: Role; org: string; active: boolean; lastSeen: string;
  /** true while the account still uses a temporary password from an administrator */
  mustChangePassword?: boolean;
  /** when that temporary password stops working */
  passwordExpiresAt?: string | null;
}
/** A user account returned with its one-time temporary password (shown once to the administrator). */
export type IssuedUser = LiveUser & { temporaryPassword: string };
/** A live change from the API's event stream (/api/events): a ledger commit, or a change in PostgreSQL. */
export interface LiveEvent { kind: 'ledger' | 'app'; name: string; shipmentId?: string; txId?: string; block?: number; status?: string; operation?: string; at: string; }
/** Which ledger the API writes to: the Hyperledger Fabric network, or the local development ledger used before Fabric runs. */
export type LedgerKind = 'fabric' | 'local';
export interface AuthResponse { token: string; user: LiveUser; demoRoleSwitch: boolean; ledger?: LedgerKind; }
/** Outcome of a ledger operation: committed on Fabric, or rejected by the chaincode / application. */
export interface LedgerResult { passed: boolean; failure?: string; failedRule?: string; reason?: string; source?: 'chaincode' | 'application'; transactionId: string; txId?: string; block?: number; pending?: false; }
/** HTTP 202: the ledger has not confirmed the transaction yet; the API applies it once its outcome is known. */
export interface PendingResult { pending: true; ledgerState: 'pending'; operationId: string; txId: string; transactionId: string; id?: string; message: string; }
export type VerifyStatus = 'verified' | 'mismatch' | 'not_found' | 'pending' | 'ledger_unavailable' | 'failed';
export interface VerifyResult { shipmentId: string; status?: VerifyStatus; onLedger: boolean; match: boolean; differences: string[]; note?: string; lastTxId?: string | null; checkedAt?: string; ledger?: Record<string, unknown>; history?: unknown[]; }
/** Live state: the dashboard's AppData plus inventory positions computed by the API from PostgreSQL. */
export type LiveState = AppData & { inventory?: Inventory[] };
/** A result file from analysis/results, served by the API with where it came from. */
export interface AnalyticsResult<T = unknown> { data: T; provenance: { artifact: string; file: string; script: string; dataset: string; generatedAt: string; sha256: string; note: string } }

/** A new key per user action, so a retried request (for example after a network error) is not recorded twice. */
export const newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const token = session.get();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'Wethaq API is not reachable — start it with npm run dev in wethaq-api');
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch {
    throw new ApiError(res.status, 'Wethaq API is not reachable — start it with npm run dev in wethaq-api');
  }
  // 422 = a ledger operation was rejected; this is a business result, not a transport failure. Only a body
  // that is really a rejection result counts: any other 422 is an error.
  if (res.status === 422 && json.passed === false && (json.source === 'chaincode' || json.source === 'application')) return json as T;
  if (res.status === 422) throw new ApiError(422, String(json.error || 'The request could not be processed'));
  if (!res.ok) throw new ApiError(res.status, String(json.error || `Request failed (${res.status})`));
  return json as T;
}

export const liveApi = {
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
  me: () => request<{ user: LiveUser; demoRoleSwitch: boolean; ledger?: LedgerKind }>('GET', '/auth/me'),
  /** Ends this session on the server: the token is refused from then on. */
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  switchRole: (role: Role) => request<AuthResponse>('POST', '/auth/switch', { role }),
  state: () => request<LiveState>('GET', '/state'),
  analytics: <T = unknown>(name: string) => request<AnalyticsResult<T>>('GET', `/analytics/${encodeURIComponent(name)}`),
  createShipment: (p: { partId: string; location: string; qty: number; month: string; note: string }, key = newIdempotencyKey()) => request<{ id: string; txId?: string; block?: number; pending?: boolean; message?: string }>('POST', '/shipments', p, key),
  operate: (op: Operation, shipmentId: string, qty: number, note: string, key = newIdempotencyKey()) => request<LedgerResult | PendingResult>('POST', `/shipments/${encodeURIComponent(shipmentId)}/${OPERATION_PATH[op]}`, { qty, note }, key),
  invalid: (scenario: string, shipmentId?: string) => request<LedgerResult | PendingResult>('POST', '/demo/invalid', { scenario, shipmentId }),
  verify: (shipmentId: string) => request<VerifyResult>('GET', `/shipments/${encodeURIComponent(shipmentId)}/verify`),
  ack: (id: string, note?: string) => request<{ ok: boolean }>('POST', `/alerts/${encodeURIComponent(id)}/ack`, { note }),
  addUser: (u: Omit<DemoUser, 'id' | 'lastSeen' | 'active'>) => request<IssuedUser>('POST', '/users', u),
  resetPassword: (id: string) => request<IssuedUser>('POST', `/users/${encodeURIComponent(id)}/reset-password`),
  changePassword: (currentPassword: string, newPassword: string) => request<AuthResponse>('POST', '/auth/password', { currentPassword, newPassword }),
  updateUser: (id: string, changes: { role?: Role; active?: boolean }) => request<LiveUser>('PATCH', `/users/${encodeURIComponent(id)}`, changes)
};

/**
 * Follows the API's server-sent event stream until the signal is aborted. It is read with fetch
 * (not EventSource) so the token is sent in the Authorization header rather than in the URL.
 * Resolves when the stream ends, so the caller can reconnect.
 */
export async function followEvents(onEvent: (event: LiveEvent) => void, signal: AbortSignal): Promise<void> {
  const token = session.get();
  if (!token) return;
  const res = await fetch(`${API_BASE}/api/events`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal });
  if (!res.ok || !res.body) throw new ApiError(res.status, `Live updates unavailable (${res.status})`);
  const reader = res.body.getReader(); const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (!/^event: change$/m.test(block)) continue;
      const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
      try { onEvent(JSON.parse(data) as LiveEvent); } catch { /* ignore a malformed event */ }
    }
  }
}
