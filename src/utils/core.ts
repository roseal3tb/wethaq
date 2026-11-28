import type { Role, Shipment, Transaction, Operation, CheckResult } from '../types';
export const locations = ['Central Warehouse', 'Distribution Center', 'Deployment Site'] as const;
export const classes = ['Smooth', 'Erratic', 'Intermittent', 'Lumpy'] as const;
export const roles: Role[] = ['Planner', 'Dispatcher', 'Receiver', 'Admin'];
export const identities: Record<Role, { name: string; org: string; email: string; }> = {
  Planner: { name: 'Planner A. Harbi', org: 'Logistics Command', email: 'planner@wethaq.demo' },
  Dispatcher: { name: 'Dispatcher M. Qahtani', org: 'Org1 (Issuing)', email: 'dispatcher@wethaq.demo' },
  Receiver: { name: 'Receiver S. Otaibi', org: 'Org2 (Receiving)', email: 'receiver@wethaq.demo' },
  Admin: { name: 'Admin R. Dossary', org: 'System Administration', email: 'admin@wethaq.demo' }
};
export const permissions: Record<string, Role[]> = {
  overview: roles, forecasts: ['Planner', 'Dispatcher', 'Admin'], inventory: roles, shipments: roles, ledger: roles, users: ['Admin'], request: ['Planner'], dispatch: ['Dispatcher'], transit: ['Dispatcher'], receive: ['Receiver'], manageUsers: ['Admin'], ack: roles
};
export const allowed = (role: Role, action: string) => permissions[action]?.includes(role) ?? false;
export const nf = (v: number, dp = 0) => new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
export const date = (v?: string) => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const month = (v: string) => new Date(v + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
/** Prevent imported user text being interpreted as spreadsheet formulae. */
export const csvSafe = (value: unknown): string => {
  const raw = String(value ?? '');
  if (typeof value === 'number') return raw;
  return /^[\s]*[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
};
export const downloadCSV = (name: string, rows: Record<string, unknown>[]) => { if (!rows.length) return; const cols = Object.keys(rows[0]); const csv = [cols, ...rows.map(r => cols.map(c => csvSafe(r[c])))].map(line => line.map(v => '"' + v.replace(/"/g, '""') + '"').join(',')).join('\r\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); link.download = name + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); };
export function validateOperation(operation: Operation, shipment: Shipment | undefined, qty: number, role: Role, transactions: Transaction[], ref?: string): CheckResult {
  // receivePartial, cancel and return are offered in live mode only, where the chaincode makes the final decision.
  // For the operations of demo mode the checks are the same as before: demo shipments never reach the new states.
  const receiving = operation === 'receive' || operation === 'receivePartial' || operation === 'return';
  const required = receiving ? 'Receiver' : 'Dispatcher';
  const expectedOrg = receiving ? 'Org2 (Receiving)' : 'Org1 (Issuing)';
  const validReference = !!shipment && (!ref || ref === shipment.id);
  const outstanding = (shipment?.dispatchedQty || 0) - (shipment?.receivedQty || 0);
  const limit = !shipment ? 0 : operation === 'dispatch' ? shipment.quantity : operation === 'return' ? (shipment.receivedQty || 0) : operation === 'receivePartial' ? outstanding - 1 : shipment.status === 'Partially Received' ? outstanding : (shipment.dispatchedQty || 0);
  const noQuantity = operation === 'transit' || operation === 'cancel';
  const validQty = noQuantity || (Number.isInteger(qty) && qty > 0 && !!shipment && qty <= limit);
  const allowedFrom: Record<Operation, string[]> = { dispatch: ['Requested'], transit: ['Dispatched'], receive: ['Dispatched', 'In Transit', 'Partially Received'], receivePartial: ['Dispatched', 'In Transit', 'Partially Received'], cancel: ['Requested', 'Dispatched'], return: ['Received'] };
  const validTransition = !!shipment && allowedFrom[operation].includes(shipment.status);
  const dup = (operation === 'receive' || operation === 'receivePartial') && !!shipment && (shipment.status === 'Received' || shipment.status === 'Returned' || transactions.some(t => t.shipmentId === shipment.id && t.type === 'RECEIPT' && t.status === 'Committed'));
  const rules = [
    { key: 'authorizedOrg', label: 'Authorized organization', passed: role === required, detail: `Requires ${required} · ${expectedOrg}` },
    { key: 'validReference', label: 'Valid shipment reference', passed: validReference, detail: validReference ? 'Shipment reference found' : 'Shipment reference not found' },
    { key: 'validQuantity', label: 'Valid quantity', passed: !!validQty, detail: noQuantity ? 'No quantity update' : operation === 'receivePartial' ? `A partial receipt must be positive and below the ${outstanding} still outstanding` : `Quantity must be positive and no higher than ${limit}` },
    { key: 'validTransition', label: 'Valid status transition', passed: validTransition, detail: validTransition ? 'Transition permitted' : 'Not permitted from current state' },
    { key: 'noDuplicate', label: 'No duplicate receipt', passed: !dup, detail: dup ? 'Receipt already committed' : 'No duplicate detected' }
  ];
  const priority = ['authorizedOrg', 'validReference', 'noDuplicate', 'validQuantity', 'validTransition']; const first = priority.map(k => rules.find(r => r.key === k && !r.passed)).find(Boolean); return { passed: !first, rules, failure: first?.label };
}
