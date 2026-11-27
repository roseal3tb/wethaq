import { EventEmitter } from 'node:events';

/**
 * A change that the dashboard should show without a page reload.
 * kind "ledger": a transaction committed on the ledger (from Fabric chaincode events, or the local ledger).
 * kind "app": an off-chain change in PostgreSQL (an acknowledged alert, a user change, an application-level rejection).
 */
export interface LiveEvent {
  kind: 'ledger' | 'app';
  name: string;
  shipmentId?: string;
  txId?: string;
  block?: number;
  status?: string;
  operation?: string;
  at: string;
}

/** In-process publish/subscribe for live events; the /api/events stream forwards them to the dashboard. */
export class EventBus {
  private emitter = new EventEmitter();
  constructor() { this.emitter.setMaxListeners(0); }
  emit(event: Omit<LiveEvent, 'at'> & { at?: string }) { this.emitter.emit('event', { at: new Date().toISOString(), ...event }); }
  subscribe(listener: (event: LiveEvent) => void) {
    this.emitter.on('event', listener);
    return () => { this.emitter.off('event', listener); };
  }
}
