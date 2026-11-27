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
