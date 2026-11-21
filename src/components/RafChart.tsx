import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { month, nf } from '../utils/core';
import { rafModelColor, rafModelLabel, type RafModel, type RafPoint } from '../data/raf';

/** RAF demand history with the test-window forecasts (Jul-Dec 2002) and the 6-month projection. */
export function RafForecastChart({ data, show, testStart, projectionStart }: { data: RafPoint[]; show: RafModel[]; testStart: string; projectionStart: string; }) {
  return (
    <div className="chart-box forecast-chart" role="img" aria-label="RAF monthly demand history with test-window forecasts and a six-month projection. See the table view for exact values.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 30, left: 0, bottom: 2 }}>
          <CartesianGrid stroke="var(--chart-grid, #E3EBEE)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={month} fontSize={11} tick={{ fill: 'var(--chart-tick, #526879)' }} tickLine={false} axisLine={false} minTickGap={42} />
          <YAxis width={38} fontSize={11} tick={{ fill: 'var(--chart-tick, #526879)' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12 }} labelFormatter={value => month(String(value))} formatter={(value, name) => [nf(Number(value), 2), name]} />
          <Line type="linear" dataKey="actual" stroke="var(--chart-navy, #224b68)" strokeWidth={1.8} dot={false} name="Actual demand" isAnimationActive={false} />
          {show.map(m => <Line key={m} type="linear" dataKey={m} stroke={rafModelColor[m]} strokeWidth={2.4} strokeDasharray={m === 'naive' ? '5 5' : undefined} dot={false} connectNulls={false} name={rafModelLabel[m]} isAnimationActive={false} />)}
          <ReferenceLine x={testStart} stroke="#8697A5" strokeDasharray="3 4" label={{ value: 'Test →', position: 'insideTopRight', fontSize: 10, fill: 'var(--chart-tick, #526879)' }} />
          <ReferenceLine x={projectionStart} stroke="#8697A5" strokeDasharray="3 4" label={{ value: 'Projection', position: 'top', fontSize: 10, fill: 'var(--chart-tick, #526879)' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
