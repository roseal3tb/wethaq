/**
 * Thin, typed async interface for the synthetic demonstration.
 * Swapping this layer for future Express, forecasting, and Fabric endpoints should
 * preserve component-level domain models; no runtime network connection is made.
 */
import type { AppData, Inventory, Part, Shipment, Transaction, Alert, DemoUser } from '../types';
import { PARTS, initialData, computeInventory } from '../data/mock';
import { getForecast, type Model } from '../data/forecast';
export type PageResource = 'overview' | 'forecasts' | 'inventory' | 'shipments' | 'users';
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));
const read = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;
async function mockResponse<T>(resource: string, get: () => T): Promise<T> { await sleep(250 + resource.length * 14); try { if (sessionStorage.getItem('wethaq.demoErrorOnce') === resource) { sessionStorage.removeItem('wethaq.demoErrorOnce'); throw Error('Simulated data-access failure'); } } catch (e) { if (e instanceof Error && e.message.startsWith('Simulated')) throw e; } return read(get()); }
export const mockAPI = {
  pageReady: (page: PageResource) => mockResponse(`page:${page}`, () => ({ page, ready: true } as const)),
  parts: (): Promise<Part[]> => mockResponse('parts', () => PARTS),
  inventory: (d: AppData): Promise<Inventory[]> => mockResponse('inventory', () => computeInventory(d.shipments)),
  shipments: (d: AppData): Promise<Shipment[]> => mockResponse('shipments', () => d.shipments),
  ledger: (d: AppData): Promise<Transaction[]> => mockResponse('ledger', () => d.transactions),
  alerts: (d: AppData): Promise<Alert[]> => mockResponse('alerts', () => d.alerts),
  users: (d: AppData): Promise<DemoUser[]> => mockResponse('users', () => d.users),
  state: (): Promise<AppData> => mockResponse('state', () => initialData()),
  forecast: (partId: string, location: string, horizon: number): Promise<ReturnType<typeof getForecast>> => mockResponse('forecast', () => getForecast(partId, location, horizon))
};
