import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Role, AppData, Alert, DemoUser, Shipment, Transaction, Operation, CheckResult, Rule, Location } from '../types';
import { initialData, reconcileShortageAlerts } from '../data/mock';
import { identities, uid, validateOperation } from '../utils/core';
import { ApiError, followEvents, LIVE, liveApi, session, type IssuedUser, type LedgerKind, type LedgerResult, type LiveEvent, type LiveUser, type VerifyResult } from '../api/live';
const load = <T,>(key: string, defaultValue: T, storage: 'session' | 'local' = 'session'): T => { try { const v = (storage === 'session' ? sessionStorage : localStorage).getItem(key); return v ? JSON.parse(v) as T : defaultValue; } catch { return defaultValue; } };
interface Store {
  /** true when the dashboard calls the Wethaq API (VITE_WETHAQ_LIVE=true) */
  live: boolean;
  /** In live mode, the ledger the API writes to (Fabric, or the local development ledger); null in demo mode or before sign-in */
  ledger: LedgerKind | null; user: LiveUser | null; refresh: () => Promise<void>; roleSwitch: boolean; apiDown: boolean;
  role: Role; authenticated: boolean; setRole: (r: Role) => void; login: (email: string, password: string, role: Role) => Promise<string | null>; logout: () => void;
  data: AppData; toast: string; notify: (s: string) => void; dismiss: () => void;
  resetDemo: () => void;
  createRequest: (p: { partId: string; location: Location; qty: number; month: string; note: string; }) => Promise<string>;
  validate: (operation: Operation, ship: Shipment | undefined, qty: number, reference?: string) => CheckResult;
  perform: (operation: Operation, shipmentId: string, qty: number, note: string) => Promise<CheckResult>;
  invalidDemo: (scenario: string, shipmentId?: string) => Promise<CheckResult & { transactionId: string }>;
  verifyShipment: (shipmentId: string) => Promise<VerifyResult>;
  ack: (id: string, note?: string) => void; addUser: (u: Omit<DemoUser, 'id' | 'lastSeen'>) => Promise<IssuedUser | null>; setUserRole: (id: string, r: Role) => void; toggleUser: (id: string) => void;
  /** Live mode: replaces the signed-in user's password; returns an error message, or null on success */
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  /** Live mode (Admin): issues a new temporary password for another user */
  resetPassword: (id: string) => Promise<IssuedUser | null>;
  /** Live mode: true while the dashboard receives live ledger and database changes from the API */
  liveFeed: boolean;
}
const Ctx = createContext<Store | null>(null);
const EMPTY: AppData = { shipments: [], transactions: [], alerts: [], users: [] };
const RULES: [string, string][] = [['authorizedOrg', 'Authorized organization'], ['validReference', 'Valid shipment reference'], ['validQuantity', 'Valid quantity'], ['validTransition', 'Valid status transition'], ['noDuplicate', 'No duplicate receipt']];
/** Converts an API ledger result into the dashboard's rule checklist format. */
function ledgerCheck(result: LedgerResult, base?: CheckResult): CheckResult {
  const rules: Rule[] = base?.rules.map(r => ({ ...r })) ?? RULES.map(([key, label]) => ({ key, label, passed: true, detail: 'Accepted' }));
  if (result.passed) return { passed: true, rules };
  const key = result.failedRule || 'validTransition'; const origin = result.source === 'application' ? 'Application' : 'Smart contract';
  const existing = rules.find(r => r.key === key);
  if (existing) { existing.passed = false; existing.detail = `${origin}: ${result.reason}`; } else rules.push({ key, label: key, passed: false, detail: `${origin}: ${result.reason}` });
  return { passed: false, rules, failure: `${result.failure || 'Rejected'} — ${result.reason}` };
}
export function Provider({ children }: { children: React.ReactNode; }) {
  const [role, setRoleInner] = useState<Role>(() => load('wethaq.role', 'Planner', 'local'));
  const [authenticated, setAuth] = useState(() => LIVE ? !!session.get() : load('wethaq.auth', false));
  const [user, setUser] = useState<LiveUser | null>(null);
  const [roleSwitch, setRoleSwitch] = useState(true);
  const [apiDown, setApiDown] = useState(false);
  const [ledger, setLedger] = useState<LedgerKind | null>(null);
  const [liveFeed, setLiveFeed] = useState(false);
  const ledgerRef = useRef<LedgerKind | null>(null); ledgerRef.current = ledger;
  /** Transactions submitted from this dashboard, so live events for them do not show a second toast. */
  const ownTx = useRef(new Set<string>());
  const mine = (txId?: string) => { if (txId) { ownTx.current.add(txId); if (ownTx.current.size > 200) ownTx.current.delete(ownTx.current.values().next().value!); } };
  const [data, setData] = useState<AppData>(() => {
    if (LIVE) return EMPTY;
    const restored = load('wethaq.data', initialData());
    // Repair previous demo-session records when moving to the clearer ATTEMPT terminology
    return { ...restored, transactions: restored.transactions.map(t => ({
      ...t, hash: '', ...(t.status === 'Rejected' ? { type: 'ATTEMPT' as const } : {})
    })) };
  });
  const [toast, setToast] = useState('');
  const roleRef = useRef(role); roleRef.current = role;
  useEffect(() => { try { localStorage.setItem('wethaq.role', JSON.stringify(role)); } catch { } }, [role]);
  useEffect(() => { if (!LIVE) { try { sessionStorage.setItem('wethaq.auth', JSON.stringify(authenticated)); } catch { } } }, [authenticated]);
  useEffect(() => { if (!LIVE) { try { sessionStorage.setItem('wethaq.data', JSON.stringify(data)); } catch { } } }, [data]);
  const notify = (s: string) => setToast(s);
  const failure = (err: unknown) => {
    const message = err instanceof Error ? err.message : 'Unexpected request failure';
    if (LIVE) setApiDown(err instanceof ApiError && (err.status === 0 || err.status >= 500));
    notify(message);
  };
  const refresh = async (): Promise<void> => {
    if (!LIVE) return;
    try {
      const identity = await liveApi.me();
      setUser(identity.user);
      setRoleInner(identity.user.role);
      setRoleSwitch(identity.demoRoleSwitch);
      setLedger(identity.ledger ?? null);
      setAuth(true);
      // An account with a temporary password sees nothing until it has chosen its own password.
      if (identity.user.mustChangePassword) { setData(EMPTY); setApiDown(false); return; }
      setData(await liveApi.state());
      setApiDown(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        session.clear(); setAuth(false); setUser(null);
      }
      setApiDown(true);
      throw err;
    }
  };
  useEffect(() => {
    if (LIVE && session.get()) { void refresh().catch(failure); }
  }, []);
  // Live updates: reload when the ledger commits a transaction or the database changes, from any user.
  const followUser = LIVE && authenticated && user && !user.mustChangePassword ? user.id : null;
  useEffect(() => {
    if (!followUser) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = (event: LiveEvent) => {
      if (event.kind === 'ledger' && event.txId && !ownTx.current.has(event.txId)) {
        const where = ledgerRef.current === 'local' ? 'the local development ledger' : 'Fabric';
        notify(`${event.shipmentId} · ${event.status === 'Rejected' ? 'rejected attempt recorded' : event.status} on ${where}${event.block ? ` · block ${event.block}` : ''}`);
      }
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh().catch(() => undefined); }, 400);
    };
    void (async () => {
      while (!controller.signal.aborted) {
        try { setLiveFeed(true); await followEvents(onEvent, controller.signal); } catch { /* reconnect below */ }
        setLiveFeed(false);
        if (!controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 3000));
      }
    })();
    return () => { controller.abort(); clearTimeout(timer); setLiveFeed(false); };
  }, [followUser]);
  const setRole = (r: Role) => {
    if (!LIVE) { setRoleInner(r); notify(`Viewing as ${r}`); return; }
    if (!roleSwitch) { notify('Role switching is unavailable for this account'); return; }
    void liveApi.switchRole(r).then(async response => {
      session.set(response.token); setRoleInner(response.user.role);
      setUser(response.user); setRoleSwitch(response.demoRoleSwitch);
      await refresh(); notify(`Viewing as ${response.user.role}`);
    }).catch(failure);
  };
  const login = async (email: string, password: string, r: Role): Promise<string | null> => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address';
    if (LIVE) {
      try {
        const response = await liveApi.login(email.trim(), password);
        session.set(response.token);
        setUser(response.user); setRoleInner(response.user.role);
        setRoleSwitch(response.demoRoleSwitch);
        await refresh();
        notify(response.user.mustChangePassword ? 'Choose a new password to continue' : 'Welcome to Wethaq');
        return null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) { session.clear(); setAuth(false); }
        return err instanceof Error ? err.message : 'Sign-in failed';
      }
    }
    if (password !== 'demo') return 'Invalid demonstration credentials — use the demo password';
    setRoleInner(r); setAuth(true); notify('Welcome to Wethaq');
    return null;
  };
  const logout = () => {
    if (LIVE) { session.clear(); setUser(null); setData(EMPTY); }
    setAuth(false); notify('Signed out');
  };
  const createRequest = async ({ partId, location, qty, month, note }: { partId: string; location: Location; qty: number; month: string; note: string; }): Promise<string> => {
    if (role !== 'Planner') throw new Error('Only a Planner can create a shipment request');
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000 || !note.trim()) throw new Error('Request requires a valid quantity and review note');
    if (!['Central Warehouse', 'Distribution Center', 'Deployment Site'].includes(location)) throw new Error('Invalid destination');
    if (!/^SP-\d{3}$/.test(partId)) throw new Error('Invalid part reference');
    if (LIVE) {
      const result = await liveApi.createShipment({ partId, location, qty, month, note });
      mine(result.txId);
      await refresh();
      notify(`${result.id} — shipment request created`);
      return result.id;
    }
    const id = `SHP-2026-${String(Math.max(48, ...data.shipments.map(s => Number(s.id.split('-').slice(-1)[0]) || 0)) + 1).padStart(4, '0')}`; const now = new Date().toISOString(); const actor = identities.Planner;
    const shipment: Shipment = { id, partId, quantity: qty, from: location === 'Central Warehouse' ? 'Supplier' : 'Central Warehouse', to: location, status: 'Requested', requestedBy: actor.name, requestedAt: now, forecastMonth: month, note, expectedAt: new Date(Date.now() + 14 * 86400000).toISOString(), recommendationId: `REC-${partId}-${location.replace(/\s+/g, '').slice(0, 2).toUpperCase()}`, createdInSession: true, events: [{ status: 'Requested', time: now, actor: actor.name, org: actor.org, note }] };
    setData(prev => ({ ...prev, shipments: [shipment, ...prev.shipments] })); notify(`${id} — simulated request created`); return id;
  };
  const validate = (op: Operation, s: Shipment | undefined, qty: number, reference?: string) => validateOperation(op, s, qty, role, data.transactions, reference);
  const perform = async (operation: Operation, shipmentId: string, qty: number, note: string): Promise<CheckResult> => {
    const s = data.shipments.find(x => x.id === shipmentId); const v = validate(operation, s, qty);
    if (LIVE) {
      try {
        const result = await liveApi.operate(operation, shipmentId, qty, note); mine(result.txId); await refresh();
        const label = operation === 'dispatch' ? 'Dispatch' : operation === 'transit' ? 'In-transit update' : 'Receipt';
        notify(result.passed ? `${label} committed on ${ledger === 'local' ? 'the local development ledger' : 'Fabric'} · block ${result.block}` : `Rejected by ${result.source === 'application' ? 'the application' : 'the smart contract'}: ${result.reason}`);
        return ledgerCheck(result, v);
      } catch (e) { failure(e); return { passed: false, rules: v.rules, failure: e instanceof Error ? e.message : 'Request failed' }; }
    }
    if (!v.passed) {
      const when = new Date().toISOString(); const actor = identities[role];
      const attempt: Transaction = {
        id: uid('TX-REJ'), type: 'ATTEMPT', shipmentId, partId: s?.partId || 'N/A',
        quantity: qty, org: actor.org, user: actor.name, timestamp: when,
        status: 'Rejected', hash: '', reason: v.failure || 'Validation failed',
        failedRule: v.rules.find(rule => !rule.passed)?.key, fromStatus: s?.status
      };
      const alert: Alert = { id: uid('ALT'), severity: 'Medium', type: 'Rejected attempt',
        title: 'Operation rejected', detail: shipmentId + ': ' + attempt.reason, shipmentId: s?.id,
        at: when, acknowledged: false };
      setData(prev => ({ ...prev, transactions: [attempt, ...prev.transactions], alerts: [alert, ...prev.alerts] }));
      notify('Operation rejected: ' + v.failure);
      return v;
    }
    if (!s) return v;
    const after = operation === 'dispatch' ? 'Dispatched' : operation === 'transit' ? 'In Transit' : 'Received'; const type = operation === 'dispatch' ? 'DISPATCH' : operation === 'transit' ? 'STATUS_CHANGE' : 'RECEIPT'; const now = new Date().toISOString(); const identity = identities[role]; const id = uid('TX'); const nextBlock = Math.max(0, ...data.transactions.map(t => t.block || 0)) + 1;
    const t: Transaction = { id, type, shipmentId: s.id, partId: s.partId, quantity: operation === 'transit' ? (s.dispatchedQty || s.quantity) : qty, org: identity.org, user: identity.name, timestamp: now, block: nextBlock, hash: '', status: 'Committed', fromStatus: s.status, toStatus: after };
    const updated: Shipment = { ...s, status: after, dispatchedQty: operation === 'dispatch' ? qty : s.dispatchedQty, receivedQty: operation === 'receive' ? qty : s.receivedQty, events: [...s.events, { status: after, time: now, actor: identity.name, org: identity.org, txId: id, note }] };
    const mismatch = operation === 'receive' && qty !== (s.dispatchedQty || 0);
    setData(prev => ({ ...prev, shipments: prev.shipments.map(x => x.id === s.id ? updated : x), transactions: [t, ...prev.transactions], alerts: mismatch ? [{ id: uid('ALT'), severity: 'High', type: 'Discrepancy', title: 'Receipt quantity mismatch', detail: `${s.id}: dispatched ${s.dispatchedQty}, received ${qty}`, shipmentId: s.id, at: now, acknowledged: false }, ...prev.alerts] : prev.alerts }));
    notify(`${type.replace('_', ' ')} committed (synthetic)`); return v;
  };
  const invalidDemo = async (scenario: string, shipmentId?: string): Promise<CheckResult & { transactionId: string }> => {
    if (LIVE) {
      const result = await liveApi.invalid(scenario, shipmentId); mine(result.txId); await refresh();
      notify(result.passed ? 'Unexpected: the operation was accepted by the smart contract' : `Smart contract rejected the operation: ${result.reason}`);
      return { ...ledgerCheck(result), transactionId: result.transactionId };
    }
    const fallback = data.shipments.find(s => s.status === 'Received') || data.shipments[0]; const target = data.shipments.find(s => s.id === shipmentId) || fallback;
    let op: Operation = 'receive'; let r: Role = 'Receiver'; let reference = target?.id; let qty = target?.dispatchedQty || target?.quantity || 1; let refTarget: Shipment | undefined = target;
    if (scenario === 'Unauthorized organization') { r = 'Planner'; op = 'dispatch'; }
    if (scenario === 'Invalid status transition') { op = 'dispatch'; refTarget = data.shipments.find(s => s.status === 'Received') || target; reference = refTarget?.id; r = 'Dispatcher'; }
    if (scenario === 'Quantity exceeds dispatched') { op = 'receive'; refTarget = data.shipments.find(s => s.status === 'In Transit') || target; reference = refTarget?.id; qty = (refTarget?.dispatchedQty || 1) + 12; }
    if (scenario === 'Unknown shipment reference') { refTarget = undefined; reference = 'SHP-UNKNOWN-9999'; }
    if (scenario === 'Duplicate receipt') { refTarget = data.shipments.find(s => s.status === 'Received') || target; reference = refTarget?.id; }
    const v = validateOperation(op, refTarget, qty, r, data.transactions, reference);
    const now = new Date().toISOString(); const id = uid('TX-REJ'); const entry: Transaction = { id, type: 'ATTEMPT', shipmentId: reference || 'SHP-UNKNOWN-9999', partId: refTarget?.partId || 'N/A', quantity: qty, org: identities[r].org, user: 'Demo validation tool', timestamp: now, status: 'Rejected', hash: '', reason: v.failure || scenario, failedRule: v.rules.find(x => !x.passed)?.key };
    const al: Alert = { id: uid('ALT'), type: 'Rejected attempt', severity: 'Medium', title: `Rejected · ${scenario}`, detail: `${reference}: ${v.failure}`, shipmentId: refTarget?.id, at: now, acknowledged: false };
    setData(prev => ({ ...prev, transactions: [entry, ...prev.transactions], alerts: [al, ...prev.alerts] })); notify(`Demo operation rejected: ${v.failure}`); return { ...v, transactionId: id };
  };
  const resetDemo = () => { if (LIVE) { notify('Live records cannot be reset from the demo controls'); return; } setData(initialData()); notify('Demonstration data restored'); };
  const verifyShipment = async (shipmentId: string): Promise<VerifyResult> => {
    if (LIVE) return liveApi.verify(shipmentId);
    return { shipmentId, onLedger: false, match: false, differences: [], note: 'Demonstration records are not written to Fabric. Verification is available only in Live Mode.' };
  };
  const ack = (id: string, note?: string) => {
    if (LIVE) { void liveApi.ack(id, note).then(refresh).catch(failure); return; }
    setData(prev => {
      const visible = reconcileShortageAlerts(prev).find(a => a.id === id);
      return { ...prev, alerts: prev.alerts.some(a => a.id === id)
        ? prev.alerts.map(a => a.id === id ? { ...a, acknowledged: true } : a)
        : visible ? [...prev.alerts, { ...visible, acknowledged: true }] : prev.alerts };
    });
  };
  const addUser = async (nextUser: Omit<DemoUser, 'id' | 'lastSeen'>): Promise<IssuedUser | null> => {
    if (role !== 'Admin') return null;
    if (LIVE) {
      const { active: _active, ...payload } = nextUser;
      try { const created = await liveApi.addUser(payload); await refresh(); notify(`${created.name} added · temporary password issued`); return created; }
      catch (err) { failure(err); return null; }
    }
    setData(prev => ({ ...prev, users: [{ ...nextUser, id: uid('USR'), lastSeen: new Date().toISOString() }, ...prev.users] }));
    notify('Demo user created');
    return null;
  };
  const resetPassword = async (id: string): Promise<IssuedUser | null> => {
    if (!LIVE || role !== 'Admin') return null;
    try { const issued = await liveApi.resetPassword(id); await refresh(); notify(`New temporary password issued for ${issued.name}`); return issued; }
    catch (err) { failure(err); return null; }
  };
  const changePassword = async (currentPassword: string, newPassword: string): Promise<string | null> => {
    if (!LIVE) return 'Passwords can be changed only in Live Mode';
    try {
      const response = await liveApi.changePassword(currentPassword, newPassword);
      session.set(response.token); setUser(response.user);
      await refresh(); notify('Password changed');
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { session.clear(); setAuth(false); setUser(null); }
      return err instanceof Error ? err.message : 'The password could not be changed';
    }
  };
  const setUserRole = (id: string, nextRole: Role) => {
    if (role !== 'Admin') return;
    if (LIVE) { void liveApi.updateUser(id, { role: nextRole }).then(refresh).catch(failure); return; }
    setData(prev => ({ ...prev, users: prev.users.map(user => user.id === id ? { ...user, role: nextRole } : user) }));
    notify('Role updated');
  };
  const toggleUser = (id: string) => {
    if (role !== 'Admin') return;
    if (LIVE) {
      const target = data.users.find(user => user.id === id);
      if (target) void liveApi.updateUser(id, { active: !target.active }).then(refresh).catch(failure);
      return;
    }
    setData(prev => ({ ...prev, users: prev.users.map(user => user.id === id ? { ...user, active: !user.active } : user) }));
    notify('User status updated');
  };
  const visibleData = useMemo<AppData>(() => LIVE ? data : ({ ...data, alerts: reconcileShortageAlerts(data) }), [data]);
  const store = useMemo<Store>(() => ({
    live: LIVE, ledger, user, refresh, roleSwitch, apiDown,
    role, authenticated, setRole, login, logout, data: visibleData, toast, notify,
    dismiss: () => setToast(''), createRequest, validate, perform, invalidDemo, verifyShipment,
    ack, addUser, setUserRole, toggleUser, resetDemo, changePassword, resetPassword, liveFeed
  }), [role, authenticated, visibleData, toast, user, roleSwitch, apiDown, ledger, liveFeed]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
export function useStore() { const ctx = useContext(Ctx); if (!ctx) throw Error('Store is missing'); return ctx; }
