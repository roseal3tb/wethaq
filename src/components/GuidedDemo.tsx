import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Compass, ExternalLink, ShieldCheck } from 'lucide-react';
import { useStore } from '../context/Store';
import type { Role } from '../types';
import { Button, InfoBanner, Modal } from './UI';

const steps: { label: string; title: string; body: string; route: string; role: Role; action: string }[] = [
  { label: '01 / Command center', title: 'Understand the operational picture', body: 'Start with live-in-session synthetic KPIs, inventory risk, active alerts and recorded shipment events. The numbers should remain consistent as actions are taken.', route: '/overview', role: 'Planner', action: 'Explore overview' },
  { label: '02 / Demand', title: 'Compare forecasting approaches', body: 'Inspect monthly histories, the chronological holdout, MAE, MASE and bias. The ML candidate is an illustrative surrogate, not a trained production XGBoost model.', route: '/forecasts', role: 'Planner', action: 'Inspect forecasts' },
  { label: '03 / Inventory', title: 'Review replenishment recommendations', body: 'Select an at-risk part, inspect reorder assumptions, and optionally create a simulated shipment request with a review note. This does not place an order.', route: '/inventory', role: 'Planner', action: 'Review inventory' },
  { label: '04 / Dispatch', title: 'Record a permitted dispatch', body: 'As Dispatcher, open a Requested shipment and record its quantity. The rule checklist verifies actor role, reference, quantity and valid transition.', route: '/shipments', role: 'Dispatcher', action: 'Explore dispatch' },
  { label: '05 / Receipt', title: 'Validate the receiving event', body: 'As Receiver, open a Dispatched or In Transit shipment and confirm receipt. Duplicates and excessive quantities must be rejected.', route: '/shipments', role: 'Receiver', action: 'Explore receipt' },
  { label: '06 / Ledger evidence', title: 'Trace committed records and failures', body: 'Inspect the linked history and try a rejection scenario. The display simulates Fabric-style validation; it is not a connected permissioned ledger or independent physical proof of delivery.', route: '/shipments?tab=ledger', role: 'Admin', action: 'Inspect ledger' }
];

export function GuidedDemo() {
  const navigate = useNavigate();
  const { role, setRole } = useStore();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const item = steps[step];
  return <>
    <button type="button" className="demo-tour-button" onClick={() => setOpen(true)} aria-label="Start guided demonstration">
      <Compass size={16} /><span>Guided demo</span>
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="Wethaq guided demonstration" description="Six steps connect forecasting, inventory decisions and simulated transaction traceability." width="570px">
      <div className="demo-tour-dialog">
        <div className="demo-tour-progress" aria-label={'Step ' + (step + 1) + ' of ' + steps.length}>
          {steps.map((item, i) => <span key={item.label} className={i <= step ? 'current' : ''} />)}
        </div>
        <div className="demo-tour-step">
          <span className="demo-tour-badge">{item.label}</span>
          <h4>{item.title}</h4>
          <p>{item.body}</p>
        </div>
        <p className="demo-tour-note"><ShieldCheck size={13} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 5 }} /> Suggested demo role: <strong>{item.role}</strong> {item.role !== role && '(will switch when you open the page)'}</p>
        {step === steps.length - 1 && <InfoBanner variant="warning">No live military information, payment, physical tracking, or connected Fabric network is involved in this demonstration.</InfoBanner>}
        <div className="demo-tour-actions">
          <Button variant="secondary" size="sm" disabled={step === 0} onClick={() => setStep(v => v - 1)}><ArrowLeft size={14} /> Previous</Button>
          <Button variant="secondary" size="sm" disabled={step === steps.length - 1} onClick={() => setStep(v => v + 1)}>Next <ArrowRight size={14} /></Button>
          <Button size="sm" onClick={() => { if (role !== item.role) setRole(item.role); navigate(item.route); setOpen(false); }}>{item.action} <ExternalLink size={14} /></Button>
        </div>
      </div>
    </Modal>
  </>;
}