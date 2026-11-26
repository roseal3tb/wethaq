import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Info, ChevronDown } from 'lucide-react';
import { NiceSelect } from '../components/NiceSelect';
import { downloadCSV, nf } from '../utils/core';
import { raf, rafMethodology, rafModelColor, rafModelLabel, rafModels, rafPoints, type RafModel } from '../data/raf';
import { RafForecastChart } from '../components/RafChart';
import { SmallBarChart } from '../components/Charts';
import { Badge, Button, Field, InfoBanner, Panel } from '../components/UI';
import ForecastsSynthetic from './ForecastsSynthetic';
import rolling from '../data/raf-rolling.json';

const demandClasses = ['Intermittent', 'Lumpy'] as const;

type RollingMetrics = Record<string, number>;
const rollingMean = rolling.summary_mean as Record<string, RollingMetrics>;
const rollingMin = rolling.summary_min as Record<string, RollingMetrics>;
const rollingMax = rolling.summary_max as Record<string, RollingMetrics>;
const rollingRanks = rolling.rmsse_rank_per_window as Record<string, Record<string, number>>;
const rollingOrigins = rolling.origins.map(String);
/** Methods ranked in every window, sorted by mean RMSSE; the zero forecast is a reference and is not ranked. */
const rollingRanked = Object.keys(rollingMean)
  .filter(method => rollingOrigins.every(origin => rollingRanks[origin]?.[method] !== undefined))
  .sort((a, b) => rollingMean[a].RMSSE - rollingMean[b].RMSSE);
const rollingReference = Object.keys(rollingMean).filter(method => !rollingRanked.includes(method));
const classMethods = [
  { key: 'Naive', label: 'Naive', color: rafModelColor.naive },
  { key: 'Croston', label: 'Croston', color: rafModelColor.croston },
  { key: 'TSB', label: 'TSB', color: rafModelColor.tsb },
  { key: 'Gradient boosting', label: 'Gradient boosting', color: rafModelColor.gbm }
];

export default function Forecasts() {
  const [params, setParams] = useSearchParams();
  const synthetic = params.get('view') === 'synthetic' || (params.get('part') || '').startsWith('SP-');
  const openRaf = () => setParams({ part: raf.parts[0].id });
  const openSynthetic = () => setParams({ view: 'synthetic', part: 'SP-001' });
  return <>
    <div className="page forecast-dataset-picker"><div className="forecast-mode-switch" aria-label="Select forecasting dataset">
      <Button size="sm" variant={!synthetic ? 'primary' : 'secondary'} onClick={openRaf}>RAF benchmark · actual historical data</Button>
      <Button size="sm" variant={synthetic ? 'primary' : 'secondary'} onClick={openSynthetic}>Synthetic planning demo · SP parts</Button>
    </div></div>
    {synthetic ? <ForecastsSynthetic /> : <RafForecasts />}
  </>;
}

function RafForecasts() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('All classes');
  const [show, setShow] = useState<RafModel[]>(['tsb', 'gbm']);
  const [asTable, setAsTable] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const selected = raf.parts.find(part => part.id === params.get('part')) ?? raf.parts[0];
  const eligible = useMemo(() => raf.parts.filter(part =>
    (classFilter === 'All classes' || part.demandClass === classFilter) &&
    (part.id.toLowerCase().includes(query.trim().toLowerCase()) || part.demandClass.toLowerCase().includes(query.trim().toLowerCase()))
  ), [classFilter, query]);
  const points = useMemo(() => rafPoints(selected), [selected]);
  const setPart = (id: string) => setParams({ part: id });
  const toggle = (model: RafModel) => setShow(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  const selectSearch = () => {
    const exact = eligible.find(part => part.id.toLowerCase() === query.trim().toLowerCase());
    if (exact || eligible.length === 1) setPart((exact ?? eligible[0]).id);
  };
  const exportData = () => downloadCSV(`wethaq-raf-${selected.id}`, points.map(point => ({
    month: point.month, phase: point.zone, actual: point.actual ?? '', naive: point.naive ?? '',
    croston: point.croston ?? '', tsb: point.tsb ?? '', gradientBoosting: point.gbm ?? ''
  })));
  return <div className="page">
    <div className="page-title-row"><div><span className="eyebrow">PLANNING INTELLIGENCE / RAF</span>
      <h1>Demand <em>forecasting</em></h1>
      <p>Public RAF spare-parts demand · offline forecasting analysis · historical 1996–2002</p></div>
      <div className="page-title-side"><Badge tone="olive">5,000-series benchmark</Badge>
        <Button variant="secondary" onClick={exportData}><Download size={16}/> Download CSV</Button></div>
    </div>
    <InfoBanner>Published RAF benchmark results are precomputed from the offline analysis. The 40-part interactive sample is not linked to synthetic SP-series inventory, replenishment, or shipments. Projection dates are illustrative future periods relative to the historical 2002 dataset.</InfoBanner>
    <Panel className="filters-panel"><div className="filter-heading"><span>RAF DATASET / SAMPLE</span><span>Choose a part in the 40-series sample</span></div>
      <div className="filter-grid">
        <Field label="Find RAF part"><input type="search" value={query} placeholder="Search RAF0013" aria-label="Find RAF part" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); selectSearch(); } }} /></Field>
        <Field label="Part"><NiceSelect value={selected.id} onChange={event => setPart(event.target.value)}>
          {eligible.map(part => <option key={part.id} value={part.id}>{part.id} · {part.demandClass}</option>)}
          {!eligible.some(part => part.id === selected.id) && <option value={selected.id}>{selected.id} · {selected.demandClass}</option>}
        </NiceSelect></Field>
        <Field label="Demand class"><NiceSelect value={classFilter} onChange={event => setClassFilter(event.target.value)}>
          <option value="All classes">All classes</option>{demandClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
        </NiceSelect></Field>
      </div>
      {!!query && eligible.length === 0 && <p className="filter-help" role="status">No matching RAF part in the 40-series sample. The full dataset contains 5,000 series.</p>}
    </Panel>
    <Panel title="Demand history & forecast" subtitle={`${selected.id} · ${selected.demandClass} · 78-month training / 6-month test`} action={<Badge tone="info">Actual RAF demand</Badge>}>
      <div className="chart-toolbar"><span className="chart-toolbar-label">MODEL OVERLAYS</span>
        {rafModels.map(model => <label className={`model-toggle ${show.includes(model) ? 'on' : ''}`} key={model}>
          <input type="checkbox" aria-label={`Show ${rafModelLabel[model]} overlay`} checked={show.includes(model)} onChange={() => toggle(model)} />
          <i style={{background:rafModelColor[model]}} />{rafModelLabel[model]}
        </label>)}
        <button className="table-toggle" onClick={() => setAsTable(value => !value)} aria-pressed={asTable}>{asTable ? 'View chart' : 'View as table'}</button>
      </div>
      {asTable ? <div className="table-scroller"><table><thead><tr><th>MONTH</th><th>PHASE</th><th>ACTUAL</th>{rafModels.filter(model => show.includes(model)).map(model => <th key={model}>{rafModelLabel[model]}</th>)}</tr></thead><tbody>
        {points.map(point => <tr key={`${point.month}-${point.zone}`}><td>{point.month}</td><td>{point.zone}</td><td>{point.actual === undefined ? '—' : nf(point.actual, 2)}</td>{rafModels.filter(model => show.includes(model)).map(model => <td key={model}>{point[model] === undefined ? '—' : nf(point[model]!, 2)}</td>)}</tr>)}
      </tbody></table></div> : <RafForecastChart data={points} show={show} testStart={raf.meta.testMonths[0]} projectionStart={raf.futureMonths[0]} />}
      <div className="detail-grid" style={{ marginTop: 16 }}>
        <div><span>Average interval (ADI)</span><strong>{nf(selected.adi, 2)}</strong></div>
        <div><span>Squared variation (CV²)</span><strong>{nf(selected.cv2, 2)}</strong></div>
        <div><span>Nonzero months</span><strong>{selected.monthsWithDemand}</strong></div>
        <div><span>Test demand (6m)</span><strong>{nf(selected.testActualTotal)}</strong></div>
      </div>
    </Panel>
    <Panel className="raf-model-comparison" title="Model comparison" subtitle="RAF test evaluation · 5,000 parts · Jul–Dec 2002">
      <div className="table-scroller"><table><thead><tr><th>METHOD</th><th>MAE</th><th>RMSE</th><th>MASE</th><th title="Root mean squared scaled error — lower is better">RMSSE</th><th>BIAS (ME)</th><th>FORECAST / ACTUAL</th><th>COVERAGE¹</th></tr></thead><tbody>
        {raf.overall.map(row => <tr key={row.method}><td>{row.method}</td><td>{nf(row.mae, 3)}</td><td>{nf(row.rmse, 3)}</td><td>{nf(row.mase, 3)}</td><td>{nf(row.rmsse, 3)}</td><td>{nf(row.bias, 3)}</td><td>{nf(row.forecastActual, 2)}</td><td>{nf(row.coverage, 1)}%</td></tr>)}
      </tbody></table></div>
      <p className="subtle">MAE, RMSE, MASE and RMSSE: lower is better. The zero forecast is a reference that never predicts demand; its low error reflects the many zero months in the data, not useful forecasts.</p>
      <p className="subtle">¹ Coverage here means the percentage of parts whose total forecast demand is at least their observed 6-month demand; it does not measure prediction-interval calibration.</p>
    </Panel>
    <Panel className="raf-model-comparison raf-rolling" title="Rolling-origin evaluation" subtitle={`Four forecast origins (months ${rolling.origins.join(', ')}), 6-month horizon, 5,000 RAF series`}>
      <div className="table-scroller"><table><thead><tr><th>METHOD</th><th title="Root mean squared scaled error — lower is better">MEAN RMSSE</th><th>RMSSE RANGE</th><th>MEAN MASE</th><th>MEAN FORECAST / ACTUAL</th><th>MEAN COVERAGE</th><th>RMSSE RANK BY ORIGIN ({rolling.origins.join(', ')})</th></tr></thead><tbody>
        {rollingRanked.map(method => <tr key={method}><td>{method}</td><td>{nf(rollingMean[method].RMSSE, 3)}</td><td>{nf(rollingMin[method].RMSSE, 3)}–{nf(rollingMax[method].RMSSE, 3)}</td><td>{nf(rollingMean[method].MASE, 3)}</td><td>{nf(rollingMean[method]['Forecast/Actual total'], 2)}</td><td>{nf(rollingMean[method]['Coverage % (sum fcst >= sum demand)'], 1)}%</td><td>{rollingOrigins.map(origin => rollingRanks[origin][method]).join(', ')}</td></tr>)}
      </tbody></table></div>
      <p className="subtle">Lower RMSSE and MASE are better. Coverage is the share of series whose total forecast is at least their total demand. Ranks are among the {rollingRanked.length} ranked methods{rollingReference.length ? `; the reference ${rollingReference.join(', ')} forecast (mean RMSSE ${rollingReference.map(method => nf(rollingMean[method].RMSSE, 3)).join(', ')}) is not ranked` : ''}. Results are offline analysis on historical RAF data, not live forecasts.</p>
    </Panel>
    <Panel title="Results by demand class" subtitle="Historical RAF benchmark · total forecast ÷ total demand in the test window (1.0 = equal)">
      <SmallBarChart data={raf.byClass.map(row => ({ name: String(row.name), ...Object.fromEntries(classMethods.map(method => [method.key, Number(row[method.key] ?? 0)])) }))} keys={classMethods.map(method => ({ key: method.key, label: method.label, color: method.color }))} ariaLabel="RAF forecast-to-actual ratio by demand class and method" />
      <p className="subtle">Values above 1.0 over-forecast total demand and values below 1.0 under-forecast it. Class-specific metrics and the aggregate comparison answer different questions. No single method is best across all metrics.</p>
    </Panel>
    <Panel className="method-panel"><button type="button" className="method-head" onClick={() => setMethodOpen(open => !open)} aria-expanded={methodOpen}>
      <Info size={18}/><strong>Methodology & data provenance</strong><ChevronDown size={18} className={methodOpen ? 'rotate' : ''}/></button>
      {methodOpen && <div className="method-content"><p>{rafMethodology}</p><p>The interactive sample contains {raf.parts.length} parts. Inventory policies and shipment simulations use separate synthetic SP-series data; there is no artificial cross-dataset part mapping.</p></div>}
    </Panel>
  </div>;
}
