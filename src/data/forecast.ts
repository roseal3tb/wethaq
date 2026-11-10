import { PARTS, BASE_INVENTORY, series, MONTHS, futureMonths } from './mock';
import { classes } from '../utils/core';
export type Model = 'Naive' | 'Croston' | 'XGBoost';
export const models: Model[] = ['Naive', 'Croston', 'XGBoost'];
const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / (s.length || 1);
export const naive = (train: number[], n: number) => Array(n).fill(train[train.length - 1] || 0) as number[];
export function croston(train: number[], n: number, alpha = .14) { let z = 0, p = 1, t = 1, started = false; for (const y of train) { if (y > 0) { if (!started) { z = y; p = t; started = true; } else { z += alpha * (y - z); p += alpha * (t - p); } t = 1; } else t++; } return Array(n).fill(started ? z / p : 0) as number[]; }
// Illustrative synthetic ML candidate (deterministic seasonal-lag surrogate; NOT a trained XGBoost estimator).
export function syntheticCandidate(train: number[], n: number) { const result: number[] = []; const recent = train.slice(-18), baseline = mean(recent), trend = (mean(train.slice(-12)) - mean(train.slice(-24, -12))) * .2; for (let i = 0; i < n; i++) { const seasonal = train.length >= 12 ? train[train.length - 12 + (i % 12)] : baseline; result.push(Math.max(0, Math.round((baseline * .70 + seasonal * .30 + trend * (i + 1)) * 10) / 10)); } return result; }
export const forecast = (model: Model, train: number[], n: number) => model === 'Naive' ? naive(train, n) : model === 'Croston' ? croston(train, n) : syntheticCandidate(train, n);
export function calculateMetrics(actual: number[], predicted: number[], train: number[]) { const errors = actual.map((n, i) => (predicted[i] || 0) - n); const mae = mean(errors.map(Math.abs)); const scale = mean(train.slice(1).map((n, i) => Math.abs(n - train[i]))); return { mae, mase: scale === 0 ? null : mae / scale, bias: mean(errors) }; }
export interface ForecastPoint { month: string; actual?: number; naive?: number; croston?: number; xgboost?: number; lower?: number; upper?: number; zone?: string; }
export function getForecast(part: string, location: string, horizon = 6) { const history = series(part, location); const train = history.slice(0, -12); const observed = history.slice(-12); const holdouts = Object.fromEntries(models.map(m => [m, forecast(m, train, 12)])) as Record<Model, number[]>; const future = Object.fromEntries(models.map(m => [m, forecast(m, history, horizon)])) as Record<Model, number[]>; const metrics = Object.fromEntries(models.map(m => [m, calculateMetrics(observed, holdouts[m], train)])) as Record<Model, ReturnType<typeof calculateMetrics>>; const volatility = Math.max(2, Math.sqrt(mean(history.slice(-24).map(x => (x - mean(history.slice(-24))) ** 2)))); const points: ForecastPoint[] = [...MONTHS.map((m, i) => ({ month: m, actual: history[i], ...(i >= 60 ? { naive: holdouts.Naive[i - 60], croston: holdouts.Croston[i - 60], xgboost: holdouts.XGBoost[i - 60], zone: 'Holdout' } : { zone: 'Training' }) })), ...futureMonths.slice(0, horizon).map((m, i) => ({ month: m, naive: future.Naive[i], croston: future.Croston[i], xgboost: future.XGBoost[i], lower: Math.max(0, future.XGBoost[i] - 1.28 * volatility), upper: future.XGBoost[i] + 1.28 * volatility, zone: 'Forecast' }))]; return { points, metrics, history, train, observed, future, holdouts }; }
let classCache: { name: string; Naive: number; Croston: number; XGBoost: number; }[] | undefined;
export function classMetrics() { if (classCache) return classCache; classCache = classes.map(name => { const parts = PARTS.filter(p => p.demandClass === name).slice(0, 10); const scores = parts.map(p => getForecast(p.id, 'All locations', 3).metrics); return { name, Naive: mean(scores.map(s => s.Naive.mae)), Croston: mean(scores.map(s => s.Croston.mae)), XGBoost: mean(scores.map(s => s.XGBoost.mae)) }; }); return classCache; }
export function policyMetrics() {
  // Simple deterministic, discrete monthly inventory-policy demonstration over the last 24 months.
  // Neither policy optimizes real stock. Replenishments arrive after an assumed lead time.
  const bucket = new Map<string, { demand: number; served: number; stockSum: number; observations: number; stockouts: number; }>();
  for (const row of BASE_INVENTORY) {
    const part = PARTS.find(p => p.id === row.partId)!;
    const monthly = series(row.partId, row.location).slice(-24);
    const lead = Math.max(1, Math.ceil(row.leadDays / 30.4));
    for (const policy of ['reorder', 'threshold'] as const) {
      const threshold = policy === 'reorder' ? row.reorderPoint : Math.ceil(row.reorderPoint * .78);
      const orderQty = Math.max(3, Math.ceil(row.monthlyDemand * (policy === 'reorder' ? 2.2 : 1.85)));
      let stock = Math.max(1, Math.round(row.reorderPoint * 1.25));
      const incoming: { month: number; qty: number; }[] = [];
      const key = part.demandClass + '|' + policy;
      const a = bucket.get(key) || { demand: 0, served: 0, stockSum: 0, observations: 0, stockouts: 0 };
      monthly.forEach((d, t) => {
        for (const q of incoming.filter(o => o.month === t)) stock += q.qty;
        const fulfilled = Math.min(d, stock); stock -= fulfilled;
        a.demand += d; a.served += fulfilled; a.stockSum += stock; a.observations++;
        if (fulfilled < d) a.stockouts++;
        if (stock + incoming.filter(o => o.month > t).reduce((sum, x) => sum + x.qty, 0) < threshold) {
          incoming.push({ month: t + lead, qty: orderQty });
        }
      });
      bucket.set(key, a);
    }
  }
  return classes.map(name => {
    const r = bucket.get(name + '|reorder')!, f = bucket.get(name + '|threshold')!;
    return { name, reorderFill: r.demand ? 100 * r.served / r.demand : 100, thresholdFill: f.demand ? 100 * f.served / f.demand : 100, reorderStock: r.stockSum / r.observations, thresholdStock: f.stockSum / f.observations, reorderEvents: r.stockouts, thresholdEvents: f.stockouts };
  });
}

export const methodology = 'Synthetic monthly aviation-style demand series are split chronologically: 60 training months followed by a 12-month holdout. MAE is mean absolute error, MASE scales error by the in-sample one-step naive error, and Bias is mean (forecast − actual). The XGBoost-labeled series is an illustrative synthetic candidate surrogate, not a trained XGBoost model. These demonstration outputs are not measured operational results.';
