/** The versioned analytics API serves views over the unchanged result files in analysis/results. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_DIR, analyticsV1Router } from '../src/services/analytics.js';

const app = express().use('/v1', analyticsV1Router());
const raf = JSON.parse(readFileSync(`${ANALYTICS_DIR}/raf-forecasts.json`, 'utf8'));
const sha = (f: string) => createHash('sha256').update(readFileSync(`${ANALYTICS_DIR}/${f}`)).digest('hex');

describe('analytics v1', () => {
  it('lists the two datasets separately, real and synthetic', async () => {
    const res = await request(app).get('/v1/datasets');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v1');
    expect(res.body.data.map((d: any) => [d.id, d.kind])).toEqual([['RAF', 'real'], ['SYN', 'synthetic']]);
    expect(res.body.data[0].series).toBe(5000);
    expect(res.body.limitations.join(' ')).toMatch(/never linked/);
  });
  it('names the methods actually used (no XGBoost)', async () => {
    const res = await request(app).get('/v1/methods');
    expect(res.body.data.gradientBoosting.model).toBe('scikit-learn HistGradientBoostingRegressor');
    expect(JSON.stringify(res.body)).not.toMatch(/xgboost/i);
  });
  it('lists and filters the exported RAF parts', async () => {
    const all = (await request(app).get('/v1/parts')).body;
    expect(all.data).toHaveLength(40);
    const lumpy = (await request(app).get('/v1/parts?class=Lumpy')).body.data;
    expect(lumpy.length).toBeGreaterThan(0);
    expect(lumpy.every((p: any) => p.demandClass === 'Lumpy')).toBe(true);
    expect((await request(app).get('/v1/parts?class=Smooth')).status).toBe(400);
  });
  it('returns one part\'s series exactly as exported, and refuses horizons that were not produced', async () => {
    const part = raf.parts[3];
    const res = await request(app).get(`/v1/parts/${part.id}/forecast?method=gbm&horizon=3`);
    expect(res.status).toBe(200);
    expect(res.body.data.projection).toEqual(raf.futureMonths.slice(0, 3).map((month: string, i: number) => ({ month, gbm: part.projection.gbm[i] })));
    expect(res.body.data.test.map((t: any) => t.gbm)).toEqual(part.test.gbm);
    expect(res.body.sources[0].sha256).toBe(sha('raf-forecasts.json'));
    expect((await request(app).get(`/v1/parts/${part.id}/forecast?horizon=12`)).status).toBe(400);
    expect((await request(app).get(`/v1/parts/${part.id}/forecast?method=xgboost`)).status).toBe(400);
    expect((await request(app).get('/v1/parts/SP-001/forecast')).status).toBe(404);
  });
  it('serves holdout metrics by dataset, split and method', async () => {
    const res = await request(app).get('/v1/metrics?dataset=SYN&split=validation');
    expect(res.body).toMatchObject({ dataset: 'SYN', split: 'validation' });
    const one = await request(app).get('/v1/metrics?method=TSB');
    expect(one.body.data).toHaveLength(1);
    expect((await request(app).get('/v1/metrics?method=Prophet')).status).toBe(400);
    expect((await request(app).get('/v1/metrics?dataset=XYZ')).status).toBe(400);
  });
  it('serves classification, model comparison, rolling evaluation and provenance', async () => {
    expect((await request(app).get('/v1/classification')).body.data.RAF.classCounts).toBeTruthy();
    expect((await request(app).get('/v1/model-comparison')).body.data.overall).toEqual(raf.overall);
    const rolling = (await request(app).get('/v1/rolling?method=TSB')).body.data;
    expect(Object.keys(rolling.mean)).toEqual(['TSB']);
    const prov = (await request(app).get('/v1/provenance')).body.data;
    expect(prov.every((p: any) => p.available && /^[0-9a-f]{64}$/.test(p.sha256))).toBe(true);
  });
  it('filters the synthetic inventory simulation by policy and class', async () => {
    const all = (await request(app).get('/v1/inventory-policies')).body.data;
    const policy = all[0].policy;
    const res = await request(app).get(`/v1/inventory-simulation?policy=${encodeURIComponent(policy)}&class=fast_moving`);
    expect(res.status).toBe(200);
    expect(res.body.data.headline.every((h: any) => h.policy === policy)).toBe(true);
    expect(res.body.data.byClass.every((h: any) => h.class === 'fast_moving' && h.policy === policy)).toBe(true);
    expect(res.body.dataset).toMatch(/synthetic/);
    expect((await request(app).get('/v1/inventory-simulation?policy=Magic')).status).toBe(400);
  });
});
