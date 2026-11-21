/**
 * Live data access for the Wethaq API (Express + PostgreSQL + Hyperledger Fabric Gateway).
 * Enabled when the dashboard is started with VITE_WETHAQ_LIVE=true (npm run dev:live).
 * Vite proxies /api to the local API service (see vite.config.ts).
 */
import type { AppData, Role, DemoUser } from '../types';

export const LIVE = import.meta.env.VITE_WETHAQ_LIVE === 'true';

const TOKEN_KEY = 'wethaq.token';
export const session = {
  get(): string | null { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(value: string) { try { sessionStorage.setItem(TOKEN_KEY, value); } catch { /* storage unavailable */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } }
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface LiveUser { id: string; name: string; email: string; role: Role; org: string; active: boolean; lastSeen: string; }
export interface AuthResponse { token: string; user: LiveUser; demoRoleSwitch: boolean; }
/** Outcome of a ledger operation: committed on Fabric, or rejected by the chaincode / application. */
export interface LedgerResult { passed: boolean; failure?: string; failedRule?: string; reason?: string; source?: 'chaincode' | 'application'; transactionId: string; txId?: string; block?: number; }
export interface VerifyResult { shipmentId: string; onLedger: boolean; match: boolean; differences: string[]; note?: string; ledger?: Record<string, unknown>; history?: unknown[]; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  // 422 = a ledger operation was rejected; this is a business result, not a transport failure.
  if (res.status === 422) return json as T;
  if (!res.ok) throw new ApiError(res.status, String(json.error || `Request failed (${res.status})`));
  return json as T;
}

export const liveApi = {
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
  me: () => request<{ user: LiveUser; demoRoleSwitch: boolean }>('GET', '/auth/me'),
  switchRole: (role: Role) => request<AuthResponse>('POST', '/auth/switch', { role }),
  state: () => request<AppData>('GET', '/state'),
  createShipment: (p: { partId: string; location: string; qty: number; month: string; note: string }) => request<{ id: string }>('POST', '/shipments', p),
  operate: (op: 'dispatch' | 'transit' | 'receive', shipmentId: string, qty: number, note: string) => request<LedgerResult>('POST', `/shipments/${encodeURIComponent(shipmentId)}/${op}`, { qty, note }),
  invalid: (scenario: string, shipmentId?: string) => request<LedgerResult>('POST', '/demo/invalid', { scenario, shipmentId }),
  verify: (shipmentId: string) => request<VerifyResult>('GET', `/shipments/${encodeURIComponent(shipmentId)}/verify`),
  ack: (id: string, note?: string) => request<{ ok: boolean }>('POST', `/alerts/${encodeURIComponent(id)}/ack`, { note }),
  addUser: (u: Omit<DemoUser, 'id' | 'lastSeen' | 'active'>) => request<LiveUser>('POST', '/users', u),
  updateUser: (id: string, changes: { role?: Role; active?: boolean }) => request<LiveUser>('PATCH', `/users/${encodeURIComponent(id)}`, changes)
};
