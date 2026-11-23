import type { CSSProperties } from 'react';
import { Activity, ArrowRight, Boxes, Database, ShieldCheck, Truck } from 'lucide-react';

/** Decorative, illustrative workflow: deliberately not connected to a ledger or live data. */
const flow = [
  { title: 'Demand forecasting', subtitle: 'Anticipate requirements', metric: '6-month outlook', icon: Activity, tone: 'forecast' },
  { title: 'Inventory planning', subtitle: 'Review replenishment', metric: 'Reorder review', icon: Boxes, tone: 'inventory' },
  { title: 'Shipment tracking', subtitle: 'Dispatch → receive', metric: 'Journey overview', icon: Truck, tone: 'shipment' },
  { title: 'Ledger verification', subtitle: 'Review audit records', metric: 'Validation workflow', icon: Database, tone: 'ledger' },
] as const;

export function LoginFlow() {
  return <div className="login-flow" aria-hidden="true">
    <div className="login-flow-eyebrow"><ShieldCheck size={13} /> EXPLORE THE WETHAQ WORKFLOW <span>· ILLUSTRATIVE</span></div>
    <div className="login-flow-grid">
      {flow.map(({ title, subtitle, metric, icon: Icon, tone }, i) =>
        <div className={`login-flow-card login-flow-${tone}`} key={title} style={{ '--card-index': i } as CSSProperties}>
          <div className="login-flow-card-top"><span className="login-flow-icon"><Icon size={18}/></span><span className="login-flow-number">0{i + 1}</span></div>
          <strong>{title}</strong>
          <small>{subtitle}</small>
          <div className="login-flow-card-bottom"><span className="login-flow-pulse"><i/></span><span>{metric}</span><ArrowRight size={12} /></div>
        </div>
      )}
    </div>
    <div className="login-flow-caption">Plan <span>→</span> Move <span>→</span> Verify</div>
  </div>;
}
