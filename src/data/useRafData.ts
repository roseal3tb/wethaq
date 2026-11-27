/**
 * Where the RAF forecasting results come from. Demo mode: the copies bundled with the dashboard.
 * Live mode: the API (GET /api/analytics/raf-parts and /rolling), which serves analysis/results unchanged
 * with its provenance. In live mode there is no fallback to the bundled copy: if the API cannot serve
 * the results, the page says so.
 */
import { useEffect, useState } from 'react';
import { LIVE, liveApi, type AnalyticsResult } from '../api/live';
import { raf, type RafData } from './raf';
import bundledRolling from './raf-rolling.json';

export type RollingData = typeof bundledRolling;
export interface RafSource {
  status: 'loading' | 'ready' | 'error';
  data?: RafData; rolling?: RollingData;
  /** Live mode only: the API's provenance for the two files. */
  provenance?: AnalyticsResult['provenance'][];
  error?: string;
}

let cache: Promise<RafSource> | null = null;
function loadLive(): Promise<RafSource> {
  cache ??= Promise.all([liveApi.analytics<RafData>('raf-parts'), liveApi.analytics<RollingData>('rolling')])
    .then(([parts, rolling]) => ({ status: 'ready' as const, data: parts.data, rolling: rolling.data, provenance: [parts.provenance, rolling.provenance] }))
    .catch(err => { cache = null; return { status: 'error' as const, error: err instanceof Error ? err.message : 'The analysis results could not be loaded' }; });
  return cache;
}

export function useRafData(): RafSource {
  const [state, setState] = useState<RafSource>(() => LIVE ? { status: 'loading' } : { status: 'ready', data: raf, rolling: bundledRolling });
  useEffect(() => {
    if (!LIVE) return;
    let cancelled = false;
    void loadLive().then(s => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, []);
  return state;
}
