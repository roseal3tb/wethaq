import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Role, AppData, Alert, DemoUser, Shipment, Transaction, Operation, CheckResult, Location } from '../types';
import { initialData, hash } from '../data/mock';
import { identities, uid, validateOperation } from '../utils/core';
const load = <T,>(key: string, defaultValue: T, storage: 'session' | 'local' = 'session'): T => { try { const v = (storage === 'session' ? sessionStorage : localStorage).getItem(key); return v ? JSON.parse(v) as T : defaultValue; } catch { return defaultValue; } };
interface Store {
  role: Role; authenticated: boolean; setRole: (r: Role) => void; login: (email: string, password: string, role: Role) => boolean; logout: () => void;
  data: AppData; toast: string; notify: (s: string) => void; dismiss: () => void;
  resetDemo: () => void;
  createRequest: (p: { partId: string; location: Location; qty: number; month: string; note: string; }) => string;
  validate: (operation: Operation, ship: Shipment | undefined, qty: number, reference?: string) => CheckResult;
  perform: (operation: Operation, shipmentId: string, qty: number, note: string) => CheckResult;
  invalidDemo: (scenario: string, shipmentId?: string) => CheckResult;
  ack: (id: string) => void; addUser: (u: Omit<DemoUser, 'id' | 'lastSeen'>) => void; setUserRole: (id: string, r: Role) => void; toggleUser: (id: string) => void;
}
const Ctx = createContext<Store | null>(null);
export function Provider({ children }: { children: React.ReactNode; }) {
  const [role, setRoleInner] = useState<Role>(() => load('wethaq.role', 'Planner', 'local'));
  const [authenticated, setAuth] = useState(() => load('wethaq.auth', false));
  const [data, setData] = useState<AppData>(() => {
    const restored = load('wethaq.data', initialData());
    // Repair previous demo-session records when moving to the clearer ATTEMPT terminology
    return { ...restored, transactions: restored.transactions.map(t =>
      t.status === 'Rejected' && t.type !== 'ATTEMPT' ? { ...t, type: 'ATTEMPT' as const } : t
    ) };
  });
  const [toast, setToast] = useState('');
  useEffect(() => { try { localStorage.setItem('wethaq.role', JSON.stringify(role)); } catch { } }, [role]);
  useEffect(() => { try { sessionStorage.setItem('wethaq.auth', JSON.stringify(authenticated)); } catch { } }, [authenticated]);
  useEffect(() => { try { sessionStorage.setItem('wethaq.data', JSON.stringify(data)); } catch { } }, [data]);
  const notify = (s: string) => setToast(s);
  const setRole = (r: Role) => { setRoleInner(r); notify(`Viewing as ${r}`); };
  const login = (email: string, password: string, r: Role) => { if (!email.trim() || !password.trim() || password.toLowerCase() === 'wrong') return false; setRoleInner(r); setAuth(true); notify('Welcome to Wethaq'); return true; };
  const logout = () => { setAuth(false); notify('Signed out'); };
  const createRequest = ({ partId, location, qty, month, note }: { partId: string; location: Location; qty: number; month: string; note: string; }) => {
    if (role !== 'Planner') throw new Error('Only a Planner can create a shipment request');
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000 || !note.trim()) throw new Error('Request requires a valid quantity and review note');
    if (!['Central Warehouse', 'Distribution Center', 'Deployment Site'].includes(location)) throw new Error('Invalid destination');
    if (!/^SP-\d{3}$/.test(partId)) throw new Error('Invalid part reference');
    const id = `SHP-2026-${String(Math.max(48, ...data.shipments.map(s => Number(s.id.split('-').slice(-1)[0]) || 0)) + 1).padStart(4, '0')}`; const now = new Date().toISOString(); const actor = identities.Planner;
    const shipment: Shipment = { id, partId, quantity: qty, from: 'Central Warehouse', to: location, status: 'Requested', requestedBy: actor.name, requestedAt: now, forecastMonth: month, note, expectedAt: new Date(Date.now() + 14 * 86400000).toISOString(), recommendationId: `REC-${partId}-${location.replace(/\s+/g, '').slice(0, 2).toUpperCase()}`, createdInSession: true, events: [{ status: 'Requested', time: now, actor: actor.name, org: actor.org, note }] };
    setData(prev => ({ ...prev, shipments: [shipment, ...prev.shipments] })); notify(`${id} — simulated request created`); return id;
  };
  const validate = (op: Operation, s: Shipment | undefined, qty: number, reference?: string) => validateOperation(op, s, qty, role, data.transactions, reference);
  const perform = (operation: Operation, shipmentId: string, qty: number, note: string) => {
    const s = data.shipments.find(x => x.id === shipmentId); const v = validate(operation, s, qty); if (!v.passed) {
      const when = new Date().toISOString(); const actor = identities[role];
      const attempt: Transaction = {
        id: uid('TX-REJ'), type: 'ATTEMPT', shipmentId, partId: s?.partId || 'N/A',
        quantity: qty, org: actor.org, user: actor.name, timestamp: when,
        status: 'Rejected', hash: hash(Date.now()), reason: v.failure || 'Validation failed',
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
    const after = operation === 'dispatch' ? 'Dispatched' : operation === 'transit' ? 'In Transit' : 'Received'; const type = operation === 'dispatch' ? 'DISPATCH' : operation === 'transit' ? 'STATUS_CHANGE' : 'RECEIPT'; const now = new Date().toISOString(); const identity = identities[role]; const id = uid('TX'); const nextBlock = Math.max(10000, ...data.transactions.map(t => t.block || 0)) + 1;
    const t: Transaction = { id, type, shipmentId: s.id, partId: s.partId, quantity: operation === 'transit' ? (s.dispatchedQty || s.quantity) : qty, org: identity.org, user: identity.name, timestamp: now, block: nextBlock, hash: hash(nextBlock), status: 'Committed', fromStatus: s.status, toStatus: after };
    const updated: Shipment = { ...s, status: after, dispatchedQty: operation === 'dispatch' ? qty : s.dispatchedQty, receivedQty: operation === 'receive' ? qty : s.receivedQty, events: [...s.events, { status: after, time: now, actor: identity.name, org: identity.org, txId: id, note }] };
    const mismatch = operation === 'receive' && qty !== (s.dispatchedQty || 0);
    setData(prev => ({ ...prev, shipments: prev.shipments.map(x => x.id === s.id ? updated : x), transactions: [t, ...prev.transactions], alerts: mismatch ? [{ id: uid('ALT'), severity: 'High', type: 'Discrepancy', title: 'Receipt quantity mismatch', detail: `${s.id}: dispatched ${s.dispatchedQty}, received ${qty}`, shipmentId: s.id, at: now, acknowledged: false }, ...prev.alerts] : prev.alerts }));
    notify(`${type.replace('_', ' ')} committed (synthetic)`); return v;
  };
  const invalidDemo = (scenario: string, shipmentId?: string) => {
    const fallback = data.shipments.find(s => s.status === 'Received') || data.shipments[0]; const target = data.shipments.find(s => s.id === shipmentId) || fallback;
    let op: Operation = 'receive'; let r: Role = 'Receiver'; let reference = target?.id; let qty = target?.dispatchedQty || target?.quantity || 1; let refTarget: Shipment | undefined = target;
    if (scenario === 'Unauthorized organization') { r = 'Planner'; op = 'dispatch'; }
    if (scenario === 'Invalid status transition') { op = 'dispatch'; refTarget = data.shipments.find(s => s.status === 'Received') || target; reference = refTarget?.id; r = 'Dispatcher'; }
    if (scenario === 'Quantity exceeds dispatched') { op = 'receive'; refTarget = data.shipments.find(s => s.status === 'In Transit') || target; reference = refTarget?.id; qty = (refTarget?.dispatchedQty || 1) + 12; }
    if (scenario === 'Unknown shipment reference') { refTarget = undefined; reference = 'SHP-UNKNOWN-9999'; }
    if (scenario === 'Duplicate receipt') { refTarget = data.shipments.find(s => s.status === 'Received') || target; reference = refTarget?.id; }
    const v = validateOperation(op, refTarget, qty, r, data.transactions, reference);
    const now = new Date().toISOString(); const id = uid('TX-REJ'); const entry: Transaction = { id, type: 'ATTEMPT', shipmentId: reference || 'SHP-UNKNOWN-9999', partId: refTarget?.partId || 'N/A', quantity: qty, org: identities[r].org, user: 'Demo validation tool', timestamp: now, status: 'Rejected', hash: hash(Date.now()), reason: v.failure || scenario, failedRule: v.rules.find(x => !x.passed)?.key };
    const al: Alert = { id: uid('ALT'), type: 'Rejected attempt', severity: 'Medium', title: `Rejected · ${scenario}`, detail: `${reference}: ${v.failure}`, shipmentId: refTarget?.id, at: now, acknowledged: false };
    setData(prev => ({ ...prev, transactions: [entry, ...prev.transactions], alerts: [al, ...prev.alerts] })); notify(`Demo operation rejected: ${v.failure}`); return v;
  };
  const resetDemo = () => { setData(initialData()); notify('Demonstration data restored'); };
  const ack = (id: string) => setData(prev => ({ ...prev, alerts: prev.alerts.map(a => a.id === id ? { ...a, acknowledged: true } : a) }));
  const addUser = (user: Omit<DemoUser, 'id' | 'lastSeen'>) => { if (role !== 'Admin') return; setData(p => ({ ...p, users: [{ ...user, id: uid('USR'), lastSeen: new Date().toISOString() }, ...p.users] })); notify('Demo user created'); };
  const setUserRole = (id: string, r: Role) => { if (role !== 'Admin') return; setData(p => ({ ...p, users: p.users.map(u => u.id === id ? { ...u, role: r } : u) })); notify('Role updated'); };
  const toggleUser = (id: string) => { if (role !== 'Admin') return; setData(p => ({ ...p, users: p.users.map(u => u.id === id ? { ...u, active: !u.active } : u) })); notify('User status updated'); };
  const store = useMemo<Store>(() => ({ role, authenticated, setRole, login, logout, data, toast, notify, dismiss: () => setToast(''), createRequest, validate, perform, invalidDemo, ack, addUser, setUserRole, toggleUser, resetDemo }), [role, authenticated, data, toast]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
export function useStore() { const ctx = useContext(Ctx); if (!ctx) throw Error('Store is missing'); return ctx; }
