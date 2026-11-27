import { randomBytes } from 'node:crypto';
import type { OrgMsp } from '../ledger/types.js';

export const LOCATIONS = [
  { id: 'LOC-CW', name: 'Central Warehouse' },
  { id: 'LOC-DC', name: 'Distribution Center' },
  { id: 'LOC-DS', name: 'Deployment Site' }
] as const;
export const locationId = (name: string) => LOCATIONS.find(l => l.name === name)?.id;
export const locationName = (id: string) => LOCATIONS.find(l => l.id === id)?.name ?? id;

export const MSP_ORG: Record<OrgMsp, string> = { Org1MSP: 'Org1 (Issuing)', Org2MSP: 'Org2 (Receiving)' };
export const orgName = (msp: string) => MSP_ORG[msp as OrgMsp] ?? msp;

export const shortId = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
/** Dashboard identifier for a ledger transaction; the full Fabric transaction id is kept as its hash. */
export const recordId = (txId: string) => `TX-${txId.slice(0, 12).toUpperCase()}`;

/** An error that maps to an HTTP status and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
