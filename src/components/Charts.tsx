import { ResponsiveContainer, LineChart, Line, Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine, BarChart, Bar, Cell, PieChart, Pie } from 'recharts';
import { month, nf } from '../utils/core';
import type { ForecastPoint, Model } from '../data/forecast';
const naiveColor = '#7E92A6';
export function ForecastChart({ data, show = ['XGBoost'], compact = false }: { data: ForecastPoint[]; show?: Model[]; compact?: boolean }) {
  const futureCount = data.filter(point => point.zone === 'Forecast').length;
  const points = compact ? data.slice(-(18 + futureCount)) : data;
  const showCandidate = show.includes('XGBoost');
  const range = points.map(point => ({
    ...point,
    uncertainty: point.lower !== undefined && point.upper !== undefined ? [point.lower, point.upper] : null,
  }));
  return (
    <div className={`chart-box forecast-chart ${compact ? 'compact' : ''}`} role="img" aria-label="Synthetic demand history, holdout, and forecast over time. See the forecasting table for exact values.">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={range} margin={{ top: 14, right: 12, left: 0, bottom: 2 }}>
          <CartesianGrid stroke="var(--chart-grid, #E3EBEE)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={month} fontSize={11} tick={{ fill: 'var(--chart-tick, #526879)' }} tickLine={false} axisLine={false} minTickGap={compact ? 30 : 42} />
          <YAxis width={34} fontSize={11} tick={{ fill: 'var(--chart-tick, #526879)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12 }}
            labelFormatter={value => month(String(value))}
            formatter={(value, name) => [Array.isArray(value) ? value.map(bound => nf(Number(bound), 1)).join('–') : nf(Number(value), 1), name]}
          />
          {showCandidate && <Area type="monotone" dataKey="uncertainty" name="Illustrative uncertainty" stroke="none" fill="var(--chart-olive, #718339)" fillOpacity={.17} isAnimationActive={false} legendType="none" />}
          <Area type="monotone" dataKey="actual" stroke="var(--chart-navy, #224b68)" strokeWidth={2.6} fill="var(--chart-navy, #224b68)" fillOpacity={.07} dot={false} name="Actual demand" isAnimationActive={false} />
          {show.includes('Naive') && <Area type="monotone" dataKey="naive" stroke={naiveColor} strokeWidth={2} strokeDasharray="5 5" fillOpacity={0} dot={false} name="Naive baseline" isAnimationActive={false} />}
          {show.includes('Croston') && <Area type="monotone" dataKey="croston" stroke="var(--chart-croston, #96612F)" strokeWidth={2.2} fillOpacity={0} dot={false} name="Croston" isAnimationActive={false} />}
          {showCandidate && <Area type="monotone" dataKey="xgboost" stroke="var(--chart-olive, #718339)" strokeWidth={2.5} strokeDasharray="6 4" fillOpacity={0} dot={false} name="Synthetic ML candidate" isAnimationActive={false} />}
          {!compact && <ReferenceLine x="2025-11" stroke="#8697A5" strokeDasharray="3 4" label={{ value: 'Holdout →', position: 'insideTopRight', fontSize: 10, fill: 'var(--chart-tick, #526879)' }} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function SmallBarChart({ data, keys }: { data: Record<string, string | number>[]; keys: { key: string; color: string; label: string; }[]; }) { return <div className="chart-box medium" role="img" aria-label="Synthetic model comparison bar chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 16, right: 10, bottom: 0, left: -20 }} barGap={3}><CartesianGrid stroke="#EDF0F2" vertical={false} /><XAxis dataKey="name" fontSize={11} stroke="#83919C" tickLine={false} axisLine={false} /><YAxis fontSize={11} stroke="#83919C" tickLine={false} axisLine={false} /><Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #E4E9EC' }} formatter={v => nf(Number(v), 1)} /><Legend wrapperStyle={{ fontSize: 12 }} />{keys.map(k => <Bar key={k.key} dataKey={k.key} name={k.label} fill={k.color} radius={[5, 5, 0, 0]} maxBarSize={24} />)}</BarChart></ResponsiveContainer></div>; }
export function ShipmentDonut({ data }: { data: { name: string; value: number; }[]; }) { const fills = ['#AEBAC5', '#8A9A4B', '#48647C', '#0F2A44']; return <div className="donut-wrap" role="img" aria-label="Shipment counts by requested, dispatched, in transit, and received status"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} cx="50%" cy="50%" innerRadius="66%" outerRadius="87%" dataKey="value" paddingAngle={3} stroke="none" isAnimationActive={false}>{data.map((d, i) => <Cell key={d.name} fill={fills[i]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E4E9EC' }} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{data.reduce((a, b) => a + b.value, 0)}</strong><span>Total shipments</span></div></div>; }
export function StockChart({ data }: { data: { month: string; stock: number; demand: number; }[]; }) { return <div className="chart-box small" role="img" aria-label="Simulated recent stock and demand history"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 8, left: -24, bottom: 2 }}><CartesianGrid vertical={false} stroke="#EDF0F2" /><XAxis dataKey="month" tickFormatter={v => month(v)} tickLine={false} axisLine={false} fontSize={10} /><YAxis tickLine={false} axisLine={false} fontSize={10} /><Tooltip contentStyle={{ borderRadius: 12 }} /><Line dataKey="stock" stroke="#0F2A44" strokeWidth={2.3} dot={false} /><Line dataKey="demand" stroke="#8A9A4B" strokeWidth={1.8} dot={false} /></LineChart></ResponsiveContainer></div>; }
