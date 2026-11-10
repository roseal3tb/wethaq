import { PARTS, getSeries } from "./catalog";
import { crostonForecast } from "./forecast";
import { mulberry32 } from "./rng";
import { LOCATIONS, type InventoryRow, type InventoryStatus, type LocationId, type Shipment } from "./types";

export const SERVICE_LEVEL = 0.95;
export const Z_SERVICE = 1.645;
export const DAYS_PER_MONTH = 30.4;

export interface BaseStock { key: string; partId: string; location: LocationId; onHand: number; }

function std(a: number[]): number {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

interface Planning { monthlyRate: number; sigma: number; leadTimeDemand: number; safetyStock: number; reorderPoint: number; }
export function planning(partId: string, loc: LocationId, ltMonths: number): Planning {
  const series = getSeries(partId, loc);
  const monthlyRate = crostonForecast(series, 1)[0];
  const sigma = std(series.slice(-24));
  const leadTimeDemand = monthlyRate * ltMonths;
  const safetyStock = Z_SERVICE * sigma * Math.sqrt(ltMonths);
  return { monthlyRate, sigma, leadTimeDemand, safetyStock, reorderPoint: Math.ceil(leadTimeDemand + safetyStock) };
}

function buildBase(): BaseStock[] {
  const r = mulberry32(777);
  const out: BaseStock[] = [];
  for (const p of PARTS) {
    for (const l of LOCATIONS) {
      const pl = planning(p.id, l.id, p.leadTimeMonths);
      const roll = r();
      let onHand: number;
      if (roll < 0.06) onHand = Math.floor(pl.reorderPoint * (0.05 + r() * 0.3));
      else if (roll < 0.13) onHand = Math.floor(pl.reorderPoint * (0.55 + r() * 0.4));
      else if (roll < 0.19) onHand = Math.ceil(pl.reorderPoint * (3.8 + r() * 1.5)) + 4;
      else onHand = Math.ceil(pl.reorderPoint * (1.15 + r() * 1.6)) + 1;
      out.push({ key: `${p.id}|${l.id}`, partId: p.id, location: l.id, onHand });
    }
  }
  return out;
}
export const BASE_STOCK: BaseStock[] = buildBase();

export function classify(onHand: number, inTransit: number, rop: number): InventoryStatus {
  const pos = onHand + inTransit;
  if (rop > 0 && pos < rop * 0.5) return "Critical";
  if (pos < rop) return "Below ROP";
  if (rop > 0 && onHand > rop * 3.5) return "Overstock";
  return "Healthy";
}

/** Derives the inventory view from base stock, session receipts and open shipments. */
export function buildInventory(shipments: Shipment[], adjustments: Record<string, number>): InventoryRow[] {
  const transit = new Map<string, number>();
  for (const s of shipments) {
    if (s.status === "Dispatched" || s.status === "In Transit") {
      const k = `${s.partId}|${s.destination}`;
      transit.set(k, (transit.get(k) ?? 0) + (s.qtyDispatched ?? 0));
    }
  }
  return BASE_STOCK.map((b) => {
    const part = PARTS.find((p) => p.id === b.partId);
    if (!part) throw new Error(`Unknown part ${b.partId}`);
    const pl = planning(b.partId, b.location, part.leadTimeMonths);
    const onHand = b.onHand + (adjustments[b.key] ?? 0);
    const inTransit = transit.get(b.key) ?? 0;
    const daily = pl.monthlyRate / DAYS_PER_MONTH;
    const target = pl.reorderPoint + Math.ceil(pl.monthlyRate * 2);
    return {
      key: b.key,
      partId: b.partId,
      partName: part.name,
      demandClass: part.demandClass,
      location: b.location,
      onHand,
      inTransit,
      monthlyRate: pl.monthlyRate,
      sigma: pl.sigma,
      leadTimeMonths: part.leadTimeMonths,
      leadTimeDemand: pl.leadTimeDemand,
      safetyStock: pl.safetyStock,
      reorderPoint: pl.reorderPoint,
      daysOfCover: daily > 0 ? onHand / daily : null,
      status: classify(onHand, inTransit, pl.reorderPoint),
      recommendedQty: Math.max(0, target - onHand - inTransit),
    };
  });
}

/** Simulated stock history: back-casts on-hand from demand with periodic replenishment (illustrative only). */
export function stockHistory(row: InventoryRow, months: string[]): { month: string; stock: number; demand: number }[] {
  const series = getSeries(row.partId, row.location).slice(-12);
  const out: { month: string; stock: number; demand: number }[] = [];
  let stock = row.onHand;
  for (let i = series.length - 1; i >= 0; i--) {
    out.unshift({ month: months[months.length - 12 + i], stock: Math.max(0, Math.round(stock)), demand: series[i] });
    stock += series[i];
    if (stock > row.reorderPoint * 2.2 + 2) stock -= Math.ceil(row.reorderPoint * 1.2);
  }
  return out;
}

export function projection(row: InventoryRow, months: string[], withOrder: number): { month: string; noAction: number; withOrder: number }[] {
  let a = row.onHand + row.inTransit;
  let b = a;
  return months.map((m, i) => {
    a -= row.monthlyRate;
    b -= row.monthlyRate;
    if (i + 1 === row.leadTimeMonths) b += withOrder;
    return { month: m, noAction: Math.max(0, Math.round(a * 10) / 10), withOrder: Math.max(0, Math.round(b * 10) / 10) };
  });
}

// ---------- Policy comparison (simulation) ----------
export interface PolicyResult { demandClass: string; policy: "Reorder point" | "Fixed threshold"; fillRate: number; avgInventory: number; stockouts: number; }
/** Simulates the last 24 months per part/location under both policies with lead time in months. */
export function comparePolicies(): PolicyResult[] {
  const acc = new Map<string, { dem: number; met: number; inv: number; n: number; so: number }>();
  for (const p of PARTS) {
    for (const l of LOCATIONS) {
      const series = getSeries(p.id, l.id);
      const pl = planning(p.id, l.id, p.leadTimeMonths);
      const demand = series.slice(-24);
      const fixedThr = 5;
      const policies: [PolicyResult["policy"], number, number][] = [
        ["Reorder point", pl.reorderPoint, Math.max(1, Math.ceil(pl.monthlyRate * 3))],
        ["Fixed threshold", fixedThr, 10],
      ];
      for (const [name, rop, qty] of policies) {
        let stock = Math.max(rop, Math.ceil(pl.reorderPoint * 1.2));
        const pipeline: { arrive: number; qty: number }[] = [];
        const k = `${p.demandClass}|${name}`;
        const a = acc.get(k) ?? { dem: 0, met: 0, inv: 0, n: 0, so: 0 };
        demand.forEach((d, t) => {
          for (const o of pipeline.filter((o) => o.arrive === t)) stock += o.qty;
          const met = Math.min(stock, d);
          a.dem += d; a.met += met;
          if (met < d) a.so++;
          stock -= met;
          const pos = stock + pipeline.filter((o) => o.arrive > t).reduce((s, o) => s + o.qty, 0);
          if (pos <= rop) pipeline.push({ arrive: t + p.leadTimeMonths, qty });
          a.inv += stock; a.n++;
        });
        acc.set(k, a);
      }
    }
  }
  const out: PolicyResult[] = [];
  for (const c of ["Smooth", "Erratic", "Intermittent", "Lumpy"]) {
    for (const pol of ["Reorder point", "Fixed threshold"] as const) {
      const a = acc.get(`${c}|${pol}`);
      if (!a) continue;
      out.push({ demandClass: c, policy: pol, fillRate: a.dem ? a.met / a.dem : 1, avgInventory: a.inv / a.n, stockouts: a.so });
    }
  }
  return out;
}
