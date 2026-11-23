"""Export RAF forecasting results for the Wethaq dashboard (Option A: forecasting evaluated on RAF).

Writes one JSON file with
  - overall test metrics for all 5,000 parts (from forecast_results.json, produced by forecast.py)
  - metrics by demand class (Intermittent / Lumpy)
  - a deterministic sample of 40 parts (20 intermittent, 20 lumpy) with their 84-month history,
    test-window forecasts (months 79-84, origin month 78) and a 6-month projection (Jan-Jun 2003,
    origin month 84, models refit on all 84 months).

Usage: python raf_export.py <RAF_long.csv> <out_dir_with_forecast_results> <forecast.py> <out.json>
"""
import sys, json, numpy as np, pandas as pd

raf_path, res_dir, fc_path, out_path = sys.argv[1:5]
# Reuse the exact model code from forecast.py (everything above its main section).
src = open(fc_path, encoding='utf-8').read().split('\nresults = {}')[0]
src = src.replace('raf_path, syn_path, gen_path, out = sys.argv[1:5]', '')
ns = {}
exec(compile(src, fc_path, 'exec'), ns)
croston, tsb, train_gbm, predict_gbm, GBM_GRID = ns['croston'], ns['tsb'], ns['train_gbm'], ns['predict_gbm'], ns['GBM_GRID']

res = json.load(open(f'{res_dir}/forecast_results.json'))
cls = pd.read_csv(f'{res_dir}/raf_series_classes.csv', index_col=0)
raf = pd.read_csv(raf_path)
W = raf.pivot(index='series_id', columns='month_index', values='demand_qty')
ids = W.index.to_numpy(); Y = W.values.astype(float)
months = sorted(raf.month.unique())
future_months = ['2003-01', '2003-02', '2003-03', '2003-04', '2003-05', '2003-06']
H = 6
gbm_params = res['RAF']['gbm_chosen']


def classical(Yo, origin):
    tr = Yo[:, :origin]
    rep = lambda v: np.repeat(np.asarray(v, float)[:, None], H, 1)
    return {'naive': rep(tr[:, -1]), 'croston': rep([croston(y) for y in tr]), 'tsb': rep([tsb(y) for y in tr])}


def all_forecasts(origin):
    f = classical(Y, origin)
    if origin < Y.shape[1]:
        m, cat = train_gbm(Y, origin, H, None, gbm_params, stride=2)
        f['gbm'] = predict_gbm(m, cat, Y, origin, H, None)
    else:  # projection beyond the data: train on every target up to month 84
        m, cat = train_gbm(Y, origin, H, None, gbm_params, stride=2)
        f['gbm'] = predict_gbm(m, cat, np.hstack([Y, np.zeros((len(Y), H))]), origin, H, None)
    return f


test = all_forecasts(78)
proj = all_forecasts(84)

# deterministic sample: per class, 16 parts with test demand + 4 without, evenly spaced through the id order
rng_ids = []
test_demand = Y[:, 78:].sum(1) > 0
for c in ['Intermittent', 'Lumpy']:
    in_c = cls['class'].reindex(ids).values == c
    for want, n in [(True, 16), (False, 4)]:
        pool = np.flatnonzero(in_c & (test_demand == want))
        pick = pool[np.linspace(0, len(pool) - 1, n).round().astype(int)]
        rng_ids.extend(pick.tolist())
rng_ids = sorted(set(rng_ids))

r2 = lambda a: [round(float(x), 2) for x in a]
parts = []
for i in rng_ids:
    a = Y[i, 78:]
    pm = {}
    for k, F in test.items():
        e = F[i] - a
        pm[k] = {'mae': round(float(np.abs(e).mean()), 3), 'bias': round(float(e.mean()), 3),
                 'forecastTotal': round(float(F[i].sum()), 2)}
    parts.append({
        'id': ids[i], 'demandClass': cls.loc[ids[i], 'class'],
        'adi': round(float(cls.loc[ids[i], 'ADI']), 2), 'cv2': round(float(cls.loc[ids[i], 'CV2']), 3),
        'monthsWithDemand': int((Y[i] > 0).sum()), 'testActualTotal': int(a.sum()),
        'history': [int(v) for v in Y[i]],
        'test': {k: r2(F[i]) for k, F in test.items()},
        'projection': {k: r2(F[i]) for k, F in proj.items()},
        'metrics': pm,
    })

name_map = {'Zero (always 0)': 'Zero (always 0)', 'Naive (last month)': 'Naive', 'Moving average 12m': 'Moving average 12m',
            'SES': 'SES', 'Croston': 'Croston', 'SBA': 'SBA', 'TSB': 'TSB', 'Gradient boosting (Poisson)': 'Gradient boosting'}
overall = [{'method': name_map[r['method']], 'mae': r['MAE'], 'rmse': r['RMSE'], 'mase': r['MASE'], 'bias': r['Bias (ME)'],
            'forecastActual': r['Forecast/Actual total'], 'coverage': r['Coverage % (sum fcst >= sum demand)']}
           for r in res['RAF']['test']]
byc = pd.read_excel(f'{res_dir}/forecast_results.xlsx', sheet_name='RAF_test_by_SBC_class')
byclass = []
for c in ['Intermittent', 'Lumpy']:
    row = {'name': c, 'parts': int((cls['class'] == c).sum())}
    for src_name, key in [('Naive (last month)', 'Naive'), ('Croston', 'Croston'), ('TSB', 'TSB'), ('Gradient boosting (Poisson)', 'Gradient boosting')]:
        r = byc[(byc.group == c) & (byc.method == src_name)].iloc[0]
        row[key] = round(float(r['Forecast/Actual total']), 3)
        row[key + ' coverage'] = round(float(r['Coverage % (sum fcst >= sum demand)']), 1)
    byclass.append(row)

out = {
    'meta': {
        'dataset': 'RAF spare-parts demand (Teunter & Duncan, 2009), 5,000 consumable parts, Jan 1996 - Dec 2002',
        'trainMonths': 78, 'testMonths': ['2002-07', '2002-12'], 'projectionMonths': [future_months[0], future_months[-1]],
        'alpha': 0.1, 'gbm': 'scikit-learn HistGradientBoostingRegressor, Poisson loss, one global model',
        'gbmSettings': gbm_params, 'sample': f'{len(parts)} parts: 16 with and 4 without test demand per class, evenly spaced by id',
        'generatedBy': 'raf_export.py (Wethaq Sprint 3)',
    },
    'months': months, 'futureMonths': future_months,
    'overall': overall, 'byClass': byclass, 'parts': parts,
}
json.dump(out, open(out_path, 'w'), separators=(',', ':'))
print('parts', len(parts), 'bytes', len(json.dumps(out, separators=(',', ':'))))
print('sample ids', [p['id'] for p in parts][:8], '...')
print('first part projection', parts[0]['id'], parts[0]['projection'])
print('check: GBM test MAE all parts', round(float(np.abs(test['gbm'] - Y[:, 78:]).mean()), 4), '(forecast.py reported', [r['MAE'] for r in res['RAF']['test'] if r['method'].startswith('Gradient')][0], ')')
print('check: TSB test MAE all parts', round(float(np.abs(test['tsb'] - Y[:, 78:]).mean()), 4))
