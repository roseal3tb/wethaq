import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dashboard from '../src/data/raf-forecasts.json';
import rolling from '../src/data/raf-rolling.json';

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
