import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Bell, Boxes, CheckCircle2,
  Clock3, Database, ShieldCheck, Truck,
} from 'lucide-react';
import { ForecastChart, ShipmentDonut } from '../components/Charts';
import { NiceSelect } from '../components/NiceSelect';
import { MiniStat, Panel, Status } from '../components/UI';
import { useStore } from '../context/Store';
import { getForecast } from '../data/forecast';
import { computeInventory, PARTS } from '../data/mock';
import { allowed, date, nf } from '../utils/core';

const shipmentStages = ['Requested', 'Dispatched', 'In Transit', 'Received'];
const partsById = new Map(PARTS.map(part => [part.id, part]));

export default function Overview() {
  const { data, role, ack } = useStore();
  const [part, setPart] = useState(PARTS[0].id);
  const [horizon, setHorizon] = useState(6);
  const inventory = useMemo(() => computeInventory(data.shipments), [data.shipments]);
  const forecast = useMemo(() => getForecast(part, 'All locations', horizon), [part, horizon]);
  const risk = inventory.filter(row => row.status !== 'Healthy').sort((a, b) => a.daysCover - b.daysCover).slice(0, 5);
  const active = data.alerts.filter(alert => !alert.acknowledged);
  const recent = [...data.shipments].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, 4);
  const transactions = [...data.transactions].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 5);
  const groups = shipmentStages.map(name => ({
    name,
    value: data.shipments.filter(shipment => shipment.status === name).length,
  }));
  const inTransit = groups[2].value;
  const canForecast = allowed(role, 'forecasts');
  const stats = [
    { label: 'Parts tracked', value: PARTS.length, icon: Boxes, note: 'Across 3 locations', path: '/inventory', tone: 'blue' },
    { label: 'Active alerts', value: active.length, icon: Bell, note: 'Awaiting review', path: '/inventory?tab=alerts&alert=New', tone: 'amber' },
    { label: 'In transit', value: inTransit, icon: Truck, note: 'Simulated shipments', path: '/shipments?status=In+Transit', tone: 'blue' },
    { label: 'Pending receipt', value: inTransit + groups[1].value, icon: Clock3, note: 'Dispatched or in transit', path: '/shipments?status=Pending+receipt', tone: 'amber' },
    { label: 'Ledger committed', value: data.transactions.filter(transaction => transaction.status === 'Committed').length, icon: ShieldCheck, note: 'Simulated transactions', path: '/shipments?tab=ledger&status=Committed', tone: 'olive' },
  ];

  return (
    <div className="page overview-page">
      <section className="overview-hero" aria-labelledby="overview-title">
        <div className="overview-hero-art" aria-hidden="true">
          <div className="hero-orbits" />
          <div className="hero-beacon"><img src="/brand/wathaq-olive-icon-light.svg" alt="" /></div>
        </div>
        <div className="overview-hero-content">
          <span className="overview-environment"><i /> Academic demo · Synthetic data</span>
          <h1 id="overview-title">Operations <em>overview</em></h1>
          <p>Monitor demand, check inventory readiness and follow recorded shipments in one workspace</p>
          <div className="overview-hero-actions">
            <Link className="overview-hero-link" to="/inventory?tab=alerts&alert=New">Review alerts <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link className="overview-hero-link overview-hero-link-secondary" to="/shipments">Track shipments <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <div className="kpi-grid">
        {stats.map(({ icon: Icon, ...stat }) => (
          <Link to={stat.path} className={`kpi-link kpi-${stat.tone}`} key={stat.label}>
            <MiniStat label={stat.label} value={nf(stat.value)} icon={<Icon size={19} aria-hidden="true" />} note={stat.note} href={stat.path} />
          </Link>
        ))}
      </div>

      <div className="overview-primary">
        <Panel className="forecast-panel" title="Demand forecast" subtitle="Historical demand and simulated projections">
          <div className="overview-chart-controls">
            <NiceSelect className="overview-part-select" value={part} onChange={event => setPart(event.target.value)} aria-label="Select forecast part">
              {PARTS.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
            </NiceSelect>
            <div className="forecast-period" role="group" aria-label="Forecast horizon">
              {[3, 6].map(months => (
                <button key={months} type="button" aria-pressed={horizon === months} onClick={() => setHorizon(months)}>{months} mo</button>
              ))}
            </div>
          </div>
          <div className="chart-legend">
            <span><i className="legend-line navy" /> Historical demand</span>
            <span><i className="legend-line olive" /> Synthetic candidate</span>
            <span><i className="legend-band" /> Uncertainty</span>
          </div>
          <ForecastChart key={`${part}-${horizon}`} data={forecast.points} compact />
          <div className="chart-foot">
            <span>Synthetic aviation spare parts · monthly units</span>
            {canForecast && <Link className="text-link" to={`/forecasts?part=${part}&horizon=${horizon}`}>Open forecast <ArrowUpRight size={15} aria-hidden="true" /></Link>}
          </div>
        </Panel>

        <Panel className="overview-risk" title="Inventory risk watch" subtitle="Lowest estimated days of stock remaining" action={<Link to="/inventory" className="text-link">Inventory <ArrowUpRight size={15} aria-hidden="true" /></Link>}>
          <div className="risk-list">
            {risk.map(row => (
              <Link key={row.id} className="risk-row" to={`/inventory?${new URLSearchParams({ search: row.partId, location: row.location })}`}>
                <span className="risk-body"><strong>{partsById.get(row.partId)?.name}</strong><small>{row.partId} · {row.location}</small></span>
                <span className="risk-right"><Status value={row.status} /><small>{nf(row.daysCover)} days of stock</small></span>
              </Link>
            ))}
            {!risk.length && <p className="muted">No inventory risks in this snapshot</p>}
          </div>
          <div className="panel-notice"><AlertTriangle size={16} aria-hidden="true" /> Based on simulated stock and lead times</div>
        </Panel>
      </div>

      <div className="overview-bottom">
        <Panel title="Shipment status" action={<Link to="/shipments" className="text-link">Shipments <ArrowUpRight size={15} aria-hidden="true" /></Link>}>
          <div className="donut-layout">
            <ShipmentDonut data={groups} />
            <div className="status-legend">
              {groups.map((group, index) => <div key={group.name}><span><i className={`status-dot dot-${index}`} />{group.name}</span><strong>{group.value}</strong></div>)}
            </div>
          </div>
          <div className="mini-divider" />
          <div className="mini-table">
            <div className="mini-table-heading"><span>Recent shipments</span><span>Status</span></div>
            {recent.map(shipment => (
              <Link to={`/shipments?search=${shipment.id}`} key={shipment.id}>
                <span><strong>{shipment.id}</strong><small>{partsById.get(shipment.partId)?.name}</small></span>
                <Status value={shipment.status} />
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Latest ledger activity" subtitle="Committed records and rejected attempts" action={<Link to="/shipments?tab=ledger" className="text-link">Ledger <ArrowUpRight size={15} aria-hidden="true" /></Link>}>
          <div className="activity-list">
            {transactions.map(transaction => (
              <Link to={`/shipments?tab=ledger&search=${transaction.id}`} key={transaction.id}>
                <span className={`activity-icon ${transaction.status === 'Rejected' ? 'danger' : ''}`}>{transaction.status === 'Committed' ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}</span>
                <span className="activity-body"><strong>{transaction.type.toLowerCase().replace(/_/g, ' ')}</strong><small><code>{transaction.id}</code> · {date(transaction.timestamp)}</small></span>
                <Status value={transaction.status} />
              </Link>
            ))}
          </div>
          <div className="panel-notice"><Database size={15} aria-hidden="true" /> Simulated ledger records</div>
        </Panel>

        <Panel className="overview-alerts" title="Active alerts" subtitle="Shortages and discrepancies awaiting review" action={<Link to="/inventory?tab=alerts&alert=New" className="text-link">Alerts <ArrowUpRight size={15} aria-hidden="true" /></Link>}>
          <div className="alert-list">
            {active.slice(0, 5).map(alert => (
              <div className="alert-item" key={alert.id}>
                <span className={`alert-mark alert-${alert.severity.toLowerCase()}`} aria-hidden="true" />
                <div><strong>{alert.title}</strong><p>{alert.detail}</p></div>
                <button type="button" title="Acknowledge" className="icon-btn" aria-label={`Acknowledge ${alert.title}`} onClick={() => ack(alert.id)}><CheckCircle2 size={17} aria-hidden="true" /></button>
              </div>
            ))}
            {!active.length && <div className="overview-alert-empty"><CheckCircle2 size={22} aria-hidden="true" /> All alerts acknowledged</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
