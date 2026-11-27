/**
 * Read-only analytics API: serves the forecasting and inventory-simulation results produced by the
 * Python scripts in analysis/ (Sprints 3–4). The API does not recompute or alter them; each response
 * says which file it came from, when that file was written and its SHA-256, so the dashboard and the
 * report can cite exactly what was shown.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';

export const ANALYTICS_DIR = process.env.ANALYTICS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../analysis/results');

/** Each published result, with what produced it and on which dataset. */
export const ARTIFACTS = {
  assessment: { file: 'assessment.json', script: 'analysis/scripts/assess.py', dataset: 'RAF spare-parts demand (real) and synthetic aviation panel', description: 'Data checks and demand classes (smooth, erratic, intermittent, lumpy)' },
  forecasts: { file: 'forecast_results.json', script: 'analysis/scripts/forecast.py', dataset: 'RAF spare-parts demand (real); synthetic panel for comparison', description: 'Holdout accuracy of Naive, MA12, SES, Croston, SBA, TSB and a global gradient-boosting model (scikit-learn HistGradientBoostingRegressor)' },
  'raf-parts': { file: 'raf-forecasts.json', script: 'analysis/scripts/raf_export.py', dataset: 'RAF spare-parts demand (real), 40 parts', description: 'Per-part history and forecasts shown on the dashboard forecasting page' },
  rolling: { file: 'raf_rolling.json', script: 'analysis/scripts/rolling_raf.py', dataset: 'RAF spare-parts demand (real)', description: 'Rolling-origin evaluation over four windows' },
  'inventory-simulation': { file: 'inventory_sim.json', script: 'analysis/scripts/inventory_sim.py', dataset: 'Synthetic aviation panel (60 parts × 3 locations); synthetic, not real-world savings', description: 'Monthly periodic-review simulation of the current policy, a fixed threshold and forecast-based reorder points' }
} as const;
export type ArtifactName = keyof typeof ARTIFACTS;

const cache = new Map<string, { mtimeMs: number; value: { data: unknown; provenance: Record<string, unknown> } }>();

export async function loadArtifact(name: ArtifactName, dir = ANALYTICS_DIR) {
  const meta = ARTIFACTS[name];
  const file = path.join(dir, meta.file);
  const info = await stat(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === info.mtimeMs) return hit.value;
  const raw = await readFile(file);
  const value = {
    data: JSON.parse(raw.toString('utf8')) as unknown,
    provenance: {
      artifact: name, file: `analysis/results/${meta.file}`, script: meta.script, dataset: meta.dataset, description: meta.description,
      generatedAt: info.mtime.toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length,
      note: 'Produced offline by the analysis scripts; served unchanged. Results apply only to these datasets and assumptions.'
    }
  };
  cache.set(file, { mtimeMs: info.mtimeMs, value });
  return value;
}

export function analyticsRouter(dir = ANALYTICS_DIR) {
  const router = express.Router();
  router.get('/', async (_req: Request, res: Response) => {
    const list = await Promise.all((Object.keys(ARTIFACTS) as ArtifactName[]).map(async name => {
      try { return { name, available: true, ...(await loadArtifact(name, dir)).provenance }; }
      catch { return { name, available: false, file: `analysis/results/${ARTIFACTS[name].file}` }; }
    }));
    res.json(list);
  });
  router.get('/:name', async (req: Request, res: Response) => {
    const name = req.params.name as ArtifactName;
    if (!Object.hasOwn(ARTIFACTS, name)) return res.status(404).json({ error: 'Unknown analytics result' });
    try {
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.json(await loadArtifact(name, dir));
    } catch {
      // Never substitute other data: say plainly that the result file is not available.
      res.status(503).json({ error: `The ${name} result (analysis/results/${ARTIFACTS[name].file}) is not available on this server. Run analysis/run_all.sh to produce it.` });
    }
  });
  return router;
}

// ---------------------------------------------------------------------------------------------------
// Versioned analytics API (/api/analytics/v1/...): views over the same unchanged result files.
// Nothing is recomputed or joined across datasets; the RAF results and the synthetic panel stay separate.
// ---------------------------------------------------------------------------------------------------

export const ANALYTICS_VERSION = 'v1';
const RAF_MODELS = ['naive', 'croston', 'tsb', 'gbm'] as const;
type RafModel = typeof RAF_MODELS[number];
const RAF_MODEL_LABEL: Record<RafModel, string> = { naive: 'Naive', croston: 'Croston', tsb: 'TSB', gbm: 'Gradient boosting (scikit-learn HistGradientBoostingRegressor, Poisson loss)' };

class BadRequest extends Error {}
class NotFound extends Error {}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], name: string): T | undefined => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new BadRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return value as T;
};

interface RafPart { id: string; demandClass: string; adi: number; cv2: number; monthsWithDemand: number; testActualTotal: number; history: number[]; test: Record<RafModel, number[]>; projection: Record<RafModel, number[]>; metrics: Record<RafModel, unknown>; }
interface RafExport { meta: Record<string, unknown> & { trainMonths: number; testMonths: [string, string]; projectionMonths: [string, string] }; months: string[]; futureMonths: string[]; overall: Record<string, unknown>[]; byClass: Record<string, unknown>[]; parts: RafPart[]; }

const LIMITATIONS = [
  'Results apply only to these datasets and assumptions.',
  'Forecasts are offline research results, not live operational forecasts.',
  'The RAF parts (RAF0000…) and the dashboard\'s synthetic SP parts are different datasets and are never linked.',
  'The inventory simulation uses the synthetic aviation panel; it shows how policies behave, not real-world savings.',
  'XGBoost and SimPy were not used: scikit-learn HistGradientBoostingRegressor and a direct monthly simulation loop were used instead (analysis/README.md).'
];

export function analyticsV1Router(dir = ANALYTICS_DIR) {
  const router = express.Router();
  const load = (name: ArtifactName) => loadArtifact(name, dir);
  const send = (res: Response, data: unknown, sources: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    res.json({ version: ANALYTICS_VERSION, data, sources, ...extra });
  const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
      if (err instanceof NotFound) return res.status(404).json({ error: err.message });
      res.status(503).json({ error: 'An analysis result file is not available on this server. Run analysis/run_all.sh to produce it.' });
    }
  };

  /** The two datasets, what each is used for, and their data checks (assessment.py). */
  router.get('/datasets', handle(async (_req, res) => {
    const a = await load('assessment'); const r = await load('raf-parts');
    const assessment = a.data as Record<string, Record<string, unknown>>; const meta = (r.data as RafExport).meta;
    send(res, [
      { id: 'RAF', name: 'RAF spare-parts demand', kind: 'real', source: 'Teunter & Duncan (2009), public dataset', usedFor: ['forecasting'],
        period: { first: assessment.RAF.first_month, last: assessment.RAF.last_month }, series: assessment.RAF.series, rows: assessment.RAF.rows,
        trainingMonths: meta.trainMonths, evaluation: { from: meta.testMonths[0], to: meta.testMonths[1] }, checks: assessment.RAF },
      { id: 'SYN', name: 'Synthetic aviation demand panel', kind: 'synthetic', source: 'Supervisor-provided generator (generate_obj1_synthetic_demand.py)', usedFor: ['inventory simulation', 'forecasting comparison'],
        period: { first: assessment.Synthetic.first_month, last: assessment.Synthetic.last_month }, parts: assessment.Synthetic.parts, locations: assessment.Synthetic.locations, rows: assessment.Synthetic.rows, checks: assessment.Synthetic }
    ], [a.provenance, r.provenance], { limitations: LIMITATIONS });
  }));

  /** Forecasting methods and the settings that were used (forecast.py, rolling_raf.py). */
  router.get('/methods', handle(async (_req, res) => {
    const f = await load('forecasts'); const ro = await load('rolling'); const r = await load('raf-parts');
    const results = f.data as Record<string, { test: { method: string }[]; gbm_chosen: unknown }>;
    send(res, {
      evaluated: results.RAF.test.map(t => t.method),
      gradientBoosting: { model: 'scikit-learn HistGradientBoostingRegressor', loss: 'Poisson', scope: 'one global model across all parts', settingsRAF: results.RAF.gbm_chosen, settingsSYN: results.SYN.gbm_chosen },
      smoothingAlpha: { holdout: (r.data as RafExport).meta.alpha, rollingTuned: (ro.data as Record<string, unknown>).best_alpha },
      perPartSeries: RAF_MODELS.map(id => ({ id, label: RAF_MODEL_LABEL[id] })),
      metrics: ['MAE', 'RMSE', 'MASE', 'RMSSE', 'Bias (ME)', 'Forecast/Actual total', 'Coverage % (sum fcst >= sum demand)']
    }, [f.provenance, ro.provenance, r.provenance]);
  }));

  /** The 40 RAF parts exported for the dashboard (raf_export.py), with their demand class. */
  router.get('/parts', handle(async (req, res) => {
    const r = await load('raf-parts'); const data = r.data as RafExport;
    const demandClass = oneOf(req.query.class, ['Intermittent', 'Lumpy'] as const, 'class');
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const parts = data.parts.filter(p => (!demandClass || p.demandClass === demandClass) && (!q || p.id.toLowerCase().includes(q)))
      .map(({ id, demandClass, adi, cv2, monthsWithDemand, testActualTotal }) => ({ id, demandClass, adi, cv2, monthsWithDemand, testActualTotal }));
    send(res, parts, [r.provenance], { sample: data.meta.sample, total: data.parts.length });
  }));

  /** One RAF part's history, test-window forecasts and projection. Only the exported horizon (6 months) exists. */
  router.get('/parts/:id/forecast', handle(async (req, res) => {
    const r = await load('raf-parts'); const data = r.data as RafExport;
    const part = data.parts.find(p => p.id === req.params.id);
    if (!part) throw new NotFound(`No exported forecast for ${req.params.id}. Only the ${data.parts.length} sample RAF parts listed by /parts have per-part forecasts.`);
    const method = oneOf(req.query.method, RAF_MODELS, 'method');
    const horizon = req.query.horizon === undefined ? data.futureMonths.length : Number(req.query.horizon);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > data.futureMonths.length) throw new BadRequest(`horizon must be a whole number from 1 to ${data.futureMonths.length}: longer horizons were not produced`);
    const models = method ? [method] : [...RAF_MODELS];
    const train = data.meta.trainMonths;
    send(res, {
      id: part.id, demandClass: part.demandClass,
      history: data.months.slice(0, train).map((month, i) => ({ month, actual: part.history[i] })),
      test: data.months.slice(train).map((month, i) => ({ month, actual: part.history[train + i], ...Object.fromEntries(models.map(m => [m, part.test[m][i]])) })),
      projection: data.futureMonths.slice(0, horizon).map((month, i) => Object.fromEntries([['month', month], ...models.map(m => [m, part.projection[m][i]])])),
      metrics: Object.fromEntries(models.map(m => [m, part.metrics[m]]))
    }, [r.provenance], { training: { from: data.months[0], to: data.months[train - 1] }, evaluation: { from: data.meta.testMonths[0], to: data.meta.testMonths[1] }, projection: { from: data.futureMonths[0], to: data.futureMonths[horizon - 1] } });
  }));

  /** Holdout accuracy by method (forecast.py), for the RAF dataset or the synthetic panel, validation or test window. */
  router.get('/metrics', handle(async (req, res) => {
    const f = await load('forecasts');
    const dataset = oneOf(req.query.dataset, ['RAF', 'SYN'] as const, 'dataset') ?? 'RAF';
    const split = oneOf(req.query.split, ['test', 'validation'] as const, 'split') ?? 'test';
    const rows = (f.data as Record<string, Record<string, { method: string }[]>>)[dataset][split];
    const method = typeof req.query.method === 'string' && req.query.method ? req.query.method : undefined;
    const filtered = method ? rows.filter(r => r.method === method) : rows;
    if (method && !filtered.length) throw new BadRequest(`method must be one of: ${rows.map(r => r.method).join(', ')}`);
    send(res, filtered, [f.provenance], { dataset, split });
  }));

  /** Demand classes (ADI / CV²) and accuracy by class. */
  router.get('/classification', handle(async (_req, res) => {
    const a = await load('assessment'); const r = await load('raf-parts');
    const assessment = a.data as Record<string, Record<string, unknown>>;
    send(res, { RAF: { classCounts: assessment.RAF.class_counts, medianADI: assessment.RAF.ADI_median, medianCV2: assessment.RAF.CV2_median, accuracyByClass: (r.data as RafExport).byClass }, SYN: { byClass: assessment.Synthetic.by_class, syntheticBoundaries: assessment.Synthetic.SBC_by_part_class } }, [a.provenance, r.provenance]);
  }));

  /** All 5,000 RAF parts, test window: every method side by side. */
  router.get('/model-comparison', handle(async (_req, res) => {
    const r = await load('raf-parts'); const data = r.data as RafExport;
    send(res, { overall: data.overall, byClass: data.byClass }, [r.provenance], { evaluation: { from: data.meta.testMonths[0], to: data.meta.testMonths[1] } });
  }));

  /** Rolling-origin evaluation (rolling_raf.py). */
  router.get('/rolling', handle(async (req, res) => {
    const ro = await load('rolling'); const data = ro.data as Record<string, any>;
    const methods = Object.keys(data.summary_mean);
    const method = typeof req.query.method === 'string' && req.query.method ? req.query.method : undefined;
    if (method && !methods.includes(method)) throw new BadRequest(`method must be one of: ${methods.join(', ')}`);
    const pick = (o: Record<string, unknown>) => method ? { [method]: o[method] } : o;
    send(res, { origins: data.origins, bestAlpha: data.best_alpha, mean: pick(data.summary_mean), min: pick(data.summary_min), max: pick(data.summary_max), rmsseRank: data.rmsse_rank_per_window, coverageRank: data.coverage_rank_per_window, finalTuned: data.final_tuned }, [ro.provenance]);
  }));

  /** Inventory policy simulation on the synthetic panel (inventory_sim.py). */
  router.get('/inventory-simulation', handle(async (req, res) => {
    const s = await load('inventory-simulation'); const data = s.data as Record<string, any>;
    const policies = [...new Set((data.headline as { policy: string }[]).map(h => h.policy))];
    const classes = [...new Set((data.by_class as { class: string }[]).map(h => h.class))];
    const policy = oneOf(req.query.policy, policies, 'policy');
    const demandClass = oneOf(req.query.class, classes, 'class');
    const byPolicy = <T extends { policy: string }>(rows: T[]) => policy ? rows.filter(r => r.policy === policy) : rows;
    send(res, {
      headline: byPolicy(data.headline), byClass: byPolicy(data.by_class as { policy: string; class: string }[]).filter(r => !demandClass || r.class === demandClass),
      curve: byPolicy(data.curve), recorded2023StockoutPct: data.recorded_2023_stockout_pct, meanProtectionPeriodMonths: data.mean_protection_period_months
    }, [s.provenance], { dataset: 'SYN (synthetic)', assumptions: '2022 warm-up, 2023 measured, monthly periodic review, lost sales, z = 1.645 for forecast-based reorder points', limitations: LIMITATIONS });
  }));

  /** The policies compared, with their headline results (one row per policy). */
  router.get('/inventory-policies', handle(async (_req, res) => {
    const s = await load('inventory-simulation');
    send(res, (s.data as Record<string, unknown>).headline, [s.provenance], { dataset: 'SYN (synthetic)' });
  }));

  /** Where every result comes from. */
  router.get('/provenance', handle(async (_req, res) => {
    const list = await Promise.all((Object.keys(ARTIFACTS) as ArtifactName[]).map(async name => {
      try { return { name, available: true, ...(await load(name)).provenance }; }
      catch { return { name, available: false, file: `analysis/results/${ARTIFACTS[name].file}` }; }
    }));
    send(res, list, [], { reproduce: 'bash analysis/run_all.sh <path to Wethaq_Datasets> (the datasets are not in the repository; see analysis/README.md)', limitations: LIMITATIONS });
  }));
  return router;
}
