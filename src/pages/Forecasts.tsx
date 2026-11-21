import { NiceSelect } from '../components/NiceSelect';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, ChevronDown, Download, Info } from 'lucide-react';
import { downloadCSV, nf } from '../utils/core';
import { raf, rafMethodology, rafModelColor, rafModelLabel, rafModels, rafPoints, type RafModel } from '../data/raf';
import { RafForecastChart } from '../components/RafChart';
import { SmallBarChart } from '../components/Charts';
import { Badge, Button, Field, Panel } from '../components/UI';

const demandClasses = ['Intermittent', 'Lumpy'];
const tableMethods = ['Zero (always 0)', 'Naive', 'Croston', 'SBA', 'TSB', 'Gradient boosting'];
const methodColor: Record<string, string> = { Naive: rafModelColor.naive, Croston: rafModelColor.croston, TSB: rafModelColor.tsb, 'Gradient boosting': rafModelColor.gbm };
const pct = (v: number) => `${nf(v, 1)}%`;

export default function Forecasts() {
  const [params, setParams] = useSearchParams();
  const [classFilter, setClass] = useState('All classes');
  const [partSearch, setPartSearch] = useState('');
  const [methodOpen, setMethodOpen] = useState(false);
  const [show, setShow] = useState<RafModel[]>(['tsb', 'gbm']);
  const [asTable, setAsTable] = useState(false);
  const selected = raf.parts.find(p => p.id === params.get('part')) ?? raf.parts[0];
  const eligible = raf.parts.filter(p => (classFilter === 'All classes' || p.demandClass === classFilter) && p.id.toLowerCase().includes(partSearch.trim().toLowerCase()));
  const points = useMemo(() => rafPoints(selected), [selected]);
  const overall = raf.overall.filter(r => tableMethods.includes(r.method));
  const setPart = (id: string) => setParams(prev => { const out = new URLSearchParams(prev); out.set('part', id); out.delete('location'); out.delete('horizon'); return out; });
  function flip(m: RafModel) { setShow(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]); }
  function exportData() { downloadCSV(`wethaq-forecast-${selected.id}`, points.map(p => ({ month: p.month, phase: p.zone, actual: p.actual, naive: p.naive, croston: p.croston, tsb: p.tsb, gradientBoosting: p.gbm }))); }
  const [testFrom, testTo] = raf.meta.testMonths;
  return <div className="page"><div className="page-title-row"><div><span className="eyebrow">PLANNING INTELLIGENCE / 01</span><h1>Demand <em>forecasting</em></h1><p>Forecasts for real RAF spare-parts demand, evaluated on a held-out test window</p></div><div className="page-title-side"><Badge tone="info">Real RAF benchmark data</Badge><Button variant="secondary" onClick={exportData}><Download size={16} /> Download CSV</Button></div></div>
    <Panel className="filters-panel"><div className="filter-heading"><span>ANALYSIS SCOPE</span><span>{raf.parts.length} sample parts · comparison tables cover all 5,000</span></div><div className="filter-grid raf-filters">
      <Field label="Find part"><input value={partSearch} placeholder="Search part number, e.g. RAF0013" onChange={e => setPartSearch(e.target.value)} /></Field>
      <Field label="Part"><NiceSelect value={selected.id} onChange={e => setPart(e.target.value)}>{eligible.map(p => <option key={p.id} value={p.id}>{p.id} · {p.demandClass}</option>)}{!eligible.some(x => x.id === selected.id) && <option value={selected.id}>{selected.id} · {selected.demandClass}</option>}</NiceSelect></Field>
      <Field label="Demand class"><NiceSelect value={classFilter} onChange={e => { setClass(e.target.value); const matched = raf.parts.find(p => e.target.value === 'All classes' || p.demandClass === e.target.value); if (matched) setPart(matched.id); }}><option>All classes</option>{demandClasses.map(x => <option key={x}>{x}</option>)}</NiceSelect></Field>
    </div></Panel>
    <Panel title="Demand history, test window and projection" subtitle={`${selected.id} · RAF consumable part`} action={<Badge tone="info">{selected.demandClass} demand</Badge>}>
      <div className="chart-toolbar"><span className="chart-toolbar-label">MODEL OVERLAYS</span>{rafModels.map(m => <label className={`model-toggle ${show.includes(m) ? 'on' : ''}`} key={m}><input type="checkbox" checked={show.includes(m)} onChange={() => flip(m)} /><i style={{ background: rafModelColor[m] }} />{rafModelLabel[m]}</label>)}<button className="table-toggle" onClick={() => setAsTable(v => !v)}>{asTable ? 'View chart' : 'View as table'}</button></div>
      {asTable ? <div className="table-scroller chart-data-table"><table><thead><tr><th>Month</th><th>Phase</th><th>Actual</th>{rafModels.map(m => <th key={m}>{rafModelLabel[m]}</th>)}</tr></thead><tbody>{points.slice(-24).map(p => <tr key={p.month}><td>{p.month}</td><td>{p.zone}</td><td>{p.actual ?? '—'}</td>{rafModels.map(m => <td key={m}>{p[m] === undefined ? '—' : nf(p[m]!, 2)}</td>)}</tr>)}</tbody></table></div> : <RafForecastChart data={points} show={show} testStart={testFrom} projectionStart={raf.futureMonths[0]} />}
      <div className="chart-foot"><span>78 training months · test {testFrom} to {testTo} · projection {raf.futureMonths[0]} to {raf.futureMonths[raf.futureMonths.length - 1]}</span><span>ADI {nf(selected.adi, 1)} · CV² {nf(selected.cv2, 2)} · demand in {selected.monthsWithDemand} of 84 months</span></div>
      <div className="chart-action"><Info size={16} /><span>Test window demand for {selected.id}: {nf(selected.testActualTotal)} units. 6-month forecast totals: {rafModels.map(m => `${rafModelLabel[m]} ${nf(selected.metrics[m].forecastTotal, 1)}`).join(' · ')}. Forecasts support decisions; they do not trigger orders.</span></div>
    </Panel>
    <div className="two-col">
      <Panel title="Model comparison" subtitle={`Test window ${testFrom} to ${testTo} · all 5,000 RAF parts`}><div className="table-scroller"><table className="metric-table"><thead><tr><th>MODEL</th><th>MAE</th><th>MASE</th><th>BIAS</th><th>FCST ÷ ACTUAL</th><th>COVERAGE</th></tr></thead><tbody>{overall.map(r => <tr key={r.method}><td><span className="model-name"><i style={{ background: methodColor[r.method] ?? '#D5DCE1' }} />{r.method}</span></td><td>{nf(r.mae, 2)}</td><td>{nf(r.mase, 2)}</td><td>{nf(r.bias, 2)}</td><td>{nf(r.forecastActual, 2)}</td><td>{pct(r.coverage)}</td></tr>)}</tbody></table></div><div className="panel-notice"><Info size={15} /> Forecasting zero wins on MAE and MASE but covers no demand, because 61% of parts had none in the test window. Judge methods on bias and coverage together.</div></Panel>
      <Panel title="Results by demand class" subtitle="Total forecast ÷ total demand in the test window (1.00 = unbiased)"><SmallBarChart data={raf.byClass} keys={[{ key: 'Naive', color: rafModelColor.naive, label: 'Naive' }, { key: 'Croston', color: rafModelColor.croston, label: 'Croston' }, { key: 'TSB', color: rafModelColor.tsb, label: 'TSB' }, { key: 'Gradient boosting', color: rafModelColor.gbm, label: 'Gradient boosting' }]} /></Panel>
    </div>
    <Panel className="method-panel"><button className="method-head" aria-expanded={methodOpen} onClick={() => setMethodOpen(v => !v)}><span className="method-icon"><BarChart3 size={19} /></span><span><strong>Methodology & data provenance</strong><small>Evaluation definitions, assumptions, and limitations</small></span><ChevronDown className={methodOpen ? 'rotate' : ''} size={18} /></button>{methodOpen && <div className="method-content"><p>{rafMethodology}</p><p>RAF data are from the UK Royal Air Force (1996-2002), not a Saudi organisation, and carry no prices, lead times or stock levels. Results show how the methods compare on real intermittent demand; they are not measured effectiveness in a defence environment.</p></div>}</Panel></div>;
}
