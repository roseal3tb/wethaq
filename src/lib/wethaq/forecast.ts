import { HISTORY_MONTHS, HOLDOUT, PARTS, getSeries } from "./catalog";
import type { DemandClass, LocationFilter } from "./types";

export type ModelId = "naive" | "croston" | "xgboost";
export const MODEL_LABEL: Record<ModelId, string> = {
  naive: "Naive baseline",
  croston: "Croston (α = 0.1)",
  xgboost: "XGBoost-style GBM",
};

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Naive: repeats the last observed training value. */
export function naiveForecast(train: number[], h: number): number[] {
  const last = train.length ? train[train.length - 1] : 0;
  return Array(h).fill(last);
}

/** Classic Croston: SES on non-zero sizes and inter-demand intervals. */
export function crostonForecast(train: number[], h: number, alpha = 0.1): number[] {
  let z: number | null = null;
  let p: number | null = null;
  let q = 1;
  for (const y of train) {
    if (y > 0) {
      if (z === null || p === null) { z = y; p = q; }
      else { z = z + alpha * (y - z); p = p + alpha * (q - p); }
      q = 1;
    } else q += 1;
  }
  const f = z === null || p === null ? 0 : z / p;
  return Array(h).fill(f);
}

// ---------- Gradient-boosted stumps on lag features (XGBoost-style, in-browser) ----------
const N_FEAT = 7;
function features(y: number[], t: number): number[] {
  const g = (k: number) => (t - k >= 0 ? y[t - k] : 0);
  const win6 = y.slice(Math.max(0, t - 6), t);
  const win12 = y.slice(Math.max(0, t - 12), t);
  return [g(1), g(2), g(3), g(12), mean(win6), win12.filter((v) => v > 0).length / 12, t % 12];
}
interface Stump { f: number; thr: number; left: number; right: number; }
interface Gbm { base: number; stumps: Stump[]; lr: number; residualSd: number; }

export function fitGbm(y: number[], rounds = 40, lr = 0.12): Gbm {
  const X: number[][] = [];
  const Y: number[] = [];
  for (let t = 12; t < y.length; t++) { X.push(features(y, t)); Y.push(y[t]); }
  const base = mean(Y);
  const pred = Y.map(() => base);
  const stumps: Stump[] = [];
  if (Y.length < 4) return { base, stumps, lr, residualSd: 0 };
  for (let r = 0; r < rounds; r++) {
    const res = Y.map((v, i) => v - pred[i]);
    let best: Stump | null = null;
    let bestGain = 1e-9;
    for (let f = 0; f < N_FEAT; f++) {
      const vals = Array.from(new Set(X.map((x) => x[f]))).sort((a, b) => a - b);
      const step = Math.max(1, Math.floor(vals.length / 10));
      for (let k = 0; k < vals.length - 1; k += step) {
        const thr = (vals[k] + vals[k + 1]) / 2;
        let sl = 0, nl = 0, sr = 0, nr = 0;
        for (let i = 0; i < X.length; i++) {
          if (X[i][f] <= thr) { sl += res[i]; nl++; } else { sr += res[i]; nr++; }
        }
        if (nl < 3 || nr < 3) continue;
        const gain = (sl * sl) / nl + (sr * sr) / nr;
        if (gain > bestGain) { bestGain = gain; best = { f, thr, left: sl / nl, right: sr / nr }; }
      }
    }
    if (!best) break;
    stumps.push(best);
    for (let i = 0; i < X.length; i++) pred[i] += lr * (X[i][best.f] <= best.thr ? best.left : best.right);
  }
  const resid = Y.map((v, i) => v - pred[i]);
  const sd = Math.sqrt(mean(resid.map((e) => e * e)));
  return { base, stumps, lr, residualSd: sd };
}
function predictOne(m: Gbm, x: number[]): number {
  let v = m.base;
  for (const s of m.stumps) v += m.lr * (x[s.f] <= s.thr ? s.left : s.right);
  return Math.max(0, v);
}
export function gbmForecast(train: number[], h: number): { forecast: number[]; sd: number } {
  const m = fitGbm(train);
  const y = [...train];
  const out: number[] = [];
  for (let i = 0; i < h; i++) {
    const v = predictOne(m, features(y, y.length));
    out.push(v);
    y.push(v);
  }
  return { forecast: out, sd: m.residualSd };
}

// ---------- Metrics ----------
export interface Metrics { mae: number; mase: number | null; bias: number; }
export function mae(a: number[], f: number[]): number { return mean(a.map((v, i) => Math.abs(v - f[i]))); }
export function bias(a: number[], f: number[]): number { return mean(a.map((v, i) => f[i] - v)); }
/** In-sample one-step naive MAE on the training window; null when the training series is constant (undefined MASE). */
export function maseScale(train: number[]): number | null {
  if (train.length < 2) return null;
  const d: number[] = [];
  for (let i = 1; i < train.length; i++) d.push(Math.abs(train[i] - train[i - 1]));
  const s = mean(d);
  return s === 0 ? null : s;
}
export function computeMetrics(actual: number[], f: number[], train: number[]): Metrics {
  const m = mae(actual, f);
  const s = maseScale(train);
  return { mae: m, mase: s === null ? null : m / s, bias: bias(actual, f) };
}

// ---------- Cached evaluation ----------
export interface Evaluation {
  history: number[];
  train: number[];
  actualHoldout: number[];
  holdout: Record<ModelId, number[]>;
  metrics: Record<ModelId, Metrics>;
  future: Record<ModelId, number[]>;
  sd: number;
}
const cache = new Map<string, Evaluation>();
export function evaluate(partId: string, loc: LocationFilter): Evaluation {
  const key = `${partId}|${loc}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const history = getSeries(partId, loc);
  const train = history.slice(0, HISTORY_MONTHS - HOLDOUT);
  const actualHoldout = history.slice(HISTORY_MONTHS - HOLDOUT);
  const g = gbmForecast(train, HOLDOUT);
  const holdout: Record<ModelId, number[]> = {
    naive: naiveForecast(train, HOLDOUT),
    croston: crostonForecast(train, HOLDOUT),
    xgboost: g.forecast,
  };
  const gf = gbmForecast(history, 12);
  const ev: Evaluation = {
    history, train, actualHoldout, holdout,
    metrics: {
      naive: computeMetrics(actualHoldout, holdout.naive, train),
      croston: computeMetrics(actualHoldout, holdout.croston, train),
      xgboost: computeMetrics(actualHoldout, holdout.xgboost, train),
    },
    future: { naive: naiveForecast(history, 12), croston: crostonForecast(history, 12), xgboost: gf.forecast },
    sd: Math.max(gf.sd, 0.5),
  };
  cache.set(key, ev);
  return ev;
}

/** 80% band using in-sample residual SD (z = 1.2816), floored at zero. */
export const Z80 = 1.2816;

export interface ClassError { demandClass: DemandClass; parts: number; naive: number; croston: number; xgboost: number; maseNa: number; }
let classCache: ClassError[] | null = null;
/** Mean MAE per demand class over all 60 parts, aggregated location series, 12-month holdout. */
export function errorByClass(): ClassError[] {
  if (classCache) return classCache;
  const acc = new Map<DemandClass, ClassError>();
  for (const p of PARTS) {
    const ev = evaluate(p.id, "ALL");
    const e = acc.get(p.demandClass) ?? { demandClass: p.demandClass, parts: 0, naive: 0, croston: 0, xgboost: 0, maseNa: 0 };
    e.parts++;
    e.naive += ev.metrics.naive.mae;
    e.croston += ev.metrics.croston.mae;
    e.xgboost += ev.metrics.xgboost.mae;
    if (ev.metrics.naive.mase === null) e.maseNa++;
    acc.set(p.demandClass, e);
  }
  const order: DemandClass[] = ["Smooth", "Erratic", "Intermittent", "Lumpy"];
  classCache = order.filter((c) => acc.has(c)).map((c) => {
    const e = acc.get(c) as ClassError;
    return { ...e, naive: e.naive / e.parts, croston: e.croston / e.parts, xgboost: e.xgboost / e.parts };
  });
  return classCache;
}
