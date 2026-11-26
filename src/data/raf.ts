/**
 * RAF spare-parts forecasting results (real data, Teunter & Duncan 2009), exported by
 * raf_export.py from the Sprint 3 evaluation. Static file: works in demo and live mode.
 * The synthetic forecast module (forecast.ts) still drives the Overview card and the
 * inventory policy comparison.
 */
import data from './raf-forecasts.json';

export type RafModel = 'naive' | 'croston' | 'tsb' | 'gbm';
export const rafModels: RafModel[] = ['naive', 'croston', 'tsb', 'gbm'];
export const rafModelLabel: Record<RafModel, string> = { naive: 'Naive', croston: 'Croston', tsb: 'TSB', gbm: 'Gradient boosting' };
export const rafModelColor: Record<RafModel, string> = { naive: '#A2ADBA', croston: '#96612F', tsb: '#8A9A4B', gbm: '#0F2A44' };

export interface RafPartMetrics { mae: number; bias: number; forecastTotal: number; }
export interface RafPart {
  id: string; demandClass: 'Intermittent' | 'Lumpy'; adi: number; cv2: number; monthsWithDemand: number; testActualTotal: number;
  history: number[]; test: Record<RafModel, number[]>; projection: Record<RafModel, number[]>; metrics: Record<RafModel, RafPartMetrics>;
}
export interface RafOverallRow { method: string; mae: number; rmse: number; mase: number; rmsse: number; bias: number; forecastActual: number; coverage: number; }
export interface RafData {
  meta: { dataset: string; trainMonths: number; testMonths: [string, string]; projectionMonths: [string, string]; alpha: number; gbm: string; sample: string; };
  months: string[]; futureMonths: string[]; overall: RafOverallRow[]; byClass: Record<string, string | number>[]; parts: RafPart[];
}
export const raf = data as unknown as RafData;

export interface RafPoint { month: string; zone: 'History' | 'Test' | 'Projection'; actual?: number; naive?: number; croston?: number; tsb?: number; gbm?: number; }
export function rafPoints(part: RafPart): RafPoint[] {
  const train = raf.meta.trainMonths;
  const points: RafPoint[] = raf.months.map((month, i) => {
    const point: RafPoint = { month, zone: i >= train ? 'Test' : 'History', actual: part.history[i] };
    if (i >= train) for (const m of rafModels) point[m] = part.test[m][i - train];
    return point;
  });
  raf.futureMonths.forEach((month, k) => {
    const point: RafPoint = { month, zone: 'Projection' };
    for (const m of rafModels) point[m] = part.projection[m][k];
    points.push(point);
  });
  return points;
}

export const rafMethodology = 'Real monthly demand for 5,000 consumable Royal Air Force spare parts (Jan 1996 - Dec 2002; Teunter & Duncan, 2009). Every forecast uses only data up to its origin: models are trained on the first 78 months and tested on Jul-Dec 2002, the published GluonTS split. The projection for Jan-Jun 2003 refits each model on all 84 months. SES, Croston, SBA and TSB use a smoothing constant of 0.1. Gradient boosting is one scikit-learn HistGradientBoostingRegressor with a Poisson loss, trained across all parts on lagged demand, rolling means, demand frequency and time since last demand. MAE is mean absolute error; MASE scales it by each part\'s in-sample naive error; RMSSE is the root mean squared error scaled in the same way by the in-sample naive squared error and averaged across parts; bias is mean (forecast - actual); coverage is the share of parts whose 6-month forecast total is at least their 6-month demand. The parts listed here are a fixed sample of 40 (20 intermittent, 20 lumpy); the comparison tables cover all 5,000.';
