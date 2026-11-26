import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dashboard from '../src/data/raf-forecasts.json';
import rolling from '../src/data/raf-rolling.json';
import inventory from '../src/data/inventory-sim.json';

const saved = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../analysis/results', name), 'utf8'));

describe('RAF results shown in the dashboard', () => {
  it('match the saved analysis export, including RMSSE', () => {
    expect(dashboard).toEqual(saved('raf-forecasts.json'));
    const test = saved('forecast_results.json').RAF.test as { MAE: number; RMSSE: number }[];
    expect(dashboard.overall).toHaveLength(test.length);
    dashboard.overall.forEach((row, i) => {
      expect(typeof row.rmsse).toBe('number');
      expect(row.mae).toBe(test[i].MAE);
      expect(row.rmsse).toBe(test[i].RMSSE);
    });
  });
  it('use the gradient-boosting setting selected on the validation window', () => {
    const chosen = saved('forecast_results.json').RAF.gbm_chosen;
    expect(dashboard.meta.gbmSettings).toEqual(chosen);
    expect(dashboard.meta.gbmSettings.max_iter).toBe(400);
    expect(dashboard.meta.gbmSettings.learning_rate).toBe(0.03);
  });
  it('copy the rolling-origin summary exactly from the saved results', () => {
    const full = saved('raf_rolling.json');
    expect(rolling.origins).toEqual([60, 66, 72, 78]);
    for (const key of ['origins', 'best_alpha', 'summary_mean', 'summary_min', 'summary_max', 'rmsse_rank_per_window'] as const)
      expect(rolling[key]).toEqual(full[key]);
  });
});

describe('Inventory simulation results shown in the dashboard', () => {
  const full = saved('inventory_sim.json');
  type Saved = { policy: string; class?: string; z?: number; fill_rate_pct: number; stockout_months_pct: number; avg_stock_units: number; orders_per_series_year: number; lost_units: number };
  const same = (shown: { policy: string; fill: number; stockoutMonths: number; avgStock: number; ordersPerYear: number; lostUnits: number }, r: Saved) => {
    expect(shown.policy).toBe(r.policy); expect(shown.fill).toBe(r.fill_rate_pct); expect(shown.stockoutMonths).toBe(r.stockout_months_pct);
    expect(shown.avgStock).toBe(r.avg_stock_units); expect(shown.ordersPerYear).toBe(r.orders_per_series_year); expect(shown.lostUnits).toBe(r.lost_units);
  };
  it('copy the headline, per-class and service-factor results exactly', () => {
    expect(inventory.headline).toHaveLength(full.headline.length);
    inventory.headline.forEach((row, i) => same(row, full.headline[i]));
    expect(inventory.byClass).toHaveLength(full.by_class.length);
    inventory.byClass.forEach((row, i) => same(row, full.by_class[i]));
    expect(inventory.curve).toHaveLength(full.curve.length);
    inventory.curve.forEach((row, i) => { same(row, full.curve[i]); expect(row.z).toBe(full.curve[i].z); });
  });
  it('report the current policy at 82.57% fill rate and 1,241 lost units', () => {
    const current = inventory.headline.find(row => row.policy === 'Current policy')!;
    expect(current.fill).toBe(82.57);
    expect(current.lostUnits).toBe(1241);
  });
});

describe('Default RAF part', () => {
  it('opens on a sample part with test-window demand and a readable scale', async () => {
    const { rafDefaultPart } = await import('../src/data/raf');
    expect(rafDefaultPart.testActualTotal).toBeGreaterThanOrEqual(5);
    expect(Math.max(...rafDefaultPart.history)).toBeLessThanOrEqual(20);
  });
});
