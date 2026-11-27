/**
 * What the analytics API does when a result file is missing, damaged, changed after it was produced, or older
 * than the scripts that produce it. It never substitutes other data: it answers 503 or labels the result.
 * Each case runs on a temporary copy of analysis/results, so the real result files are never touched.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ANALYTICS_DIR, ARTIFACTS, analyticsRouter, analyticsV1Router } from '../src/services/analytics.js';

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A copy of the results and scripts, with a manifest written for the copy. */
function copy({ manifest = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'wethaq-analytics-'));
  dirs.push(root);
  const results = path.join(root, 'results'); const scripts = path.join(root, 'scripts');
  cpSync(ANALYTICS_DIR, results, { recursive: true });
  mkdirSync(scripts);
  const scriptNames = ['assess.py', 'forecast.py', 'raf_export.py', 'rolling_raf.py', 'inventory_sim.py'];
  for (const s of scriptNames) writeFileSync(path.join(scripts, s), `# ${s}\n`);
  rmSync(path.join(results, 'MANIFEST.json'), { force: true });
  if (manifest) {
    const uses: Record<string, string[]> = { 'assessment.json': ['assess.py'], 'forecast_results.json': ['forecast.py'], 'raf-forecasts.json': ['raf_export.py', 'forecast.py'], 'raf_rolling.json': ['rolling_raf.py', 'forecast.py'], 'inventory_sim.json': ['inventory_sim.py', 'forecast.py'] };
    writeFileSync(path.join(results, 'MANIFEST.json'), JSON.stringify({
      writtenAt: '2026-11-27T00:00:00Z',
      scripts: Object.fromEntries(scriptNames.map(s => [s, sha(`# ${s}\n`)])),
      results: Object.fromEntries(Object.values(ARTIFACTS).map(a => [a.file, { sha256: sha(readFileSync(path.join(results, a.file))), scripts: uses[a.file] }]))
    }));
  }
  const app = express().use('/a', analyticsRouter(results)).use('/v1', analyticsV1Router(results));
  return { app, results, scripts };
}

describe('analysis result files', () => {
  it('labels unchanged results as verified against the manifest', async () => {
    const { app } = copy();
    const res = await request(app).get('/a/forecasts');
    expect(res.status).toBe(200);
    expect(res.body.provenance).toMatchObject({ check: 'verified', warnings: [], scriptsChecked: true });
    expect(res.body.provenance.note).toMatch(/not live forecasts/);
  });
  it('answers 503 "missing" for a result file that is not there, and lists it as unavailable', async () => {
    const { app, results } = copy();
    rmSync(path.join(results, 'raf_rolling.json'));
    const res = await request(app).get('/a/rolling');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ reason: 'missing' });
    expect((await request(app).get('/a')).body.find((r: any) => r.name === 'rolling')).toMatchObject({ available: false, reason: 'missing' });
    expect((await request(app).get('/v1/rolling')).body).toMatchObject({ reason: 'missing' });
  });
  it('answers 503 "damaged" for a result file that is not valid JSON, without serving part of it', async () => {
    const { app, results } = copy();
    const file = path.join(results, 'forecast_results.json');
    writeFileSync(file, readFileSync(file, 'utf8').slice(0, 500));
    const res = await request(app).get('/a/forecasts');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ reason: 'damaged' });
    expect(res.body.data).toBeUndefined();
    expect((await request(app).get('/v1/metrics')).body).toMatchObject({ reason: 'damaged' });
  });
  it('answers 503 "invalid" when valid JSON does not have the expected structure', async () => {
    const { app, results } = copy();
    writeFileSync(path.join(results, 'raf-forecasts.json'), JSON.stringify({ something: 'else' }));
    const res = await request(app).get('/v1/parts');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ reason: 'invalid' });
  });
  it('labels a result file changed after the manifest was written as modified', async () => {
    const { app, results } = copy();
    const file = path.join(results, 'assessment.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...data, edited: true }));
    const res = await request(app).get('/a/assessment');
    expect(res.status).toBe(200);
    expect(res.body.provenance).toMatchObject({ check: 'modified' });
    expect(res.body.provenance.warnings[0]).toMatch(/changed or replaced/);
  });
  it('labels results as outdated when a script that produced them changed', async () => {
    const { app, scripts } = copy();
    writeFileSync(path.join(scripts, 'forecast.py'), '# forecast.py, edited\n');
    const res = await request(app).get('/a/raf-parts');
    expect(res.body.provenance).toMatchObject({ check: 'outdated' });
    expect(res.body.provenance.warnings.join(' ')).toMatch(/forecast\.py changed/);
    expect((await request(app).get('/a/assessment')).body.provenance.check).toBe('verified');
  });
  it('labels results as unverified when there is no manifest', async () => {
    const { app } = copy({ manifest: false });
    expect((await request(app).get('/a/forecasts')).body.provenance).toMatchObject({ check: 'unverified' });
  });
});
