"""Wethaq Sprint 3 — demand forecasting baselines and a gradient-boosting model.

Datasets
  RAF  : 5,000 real RAF consumable parts, 84 months (1996-2002). Validation origin = month 72
         (forecast 73-78), test origin = month 78 (forecast 79-84; the published GluonTS split). h = 6.
  SYN  : supervisor's synthetic aviation panel, 60 parts x 3 locations = 180 series, 72 months
         (2018-2023). Validation origin = Dec 2021 (forecast 2022), test origin = Dec 2022
         (forecast 2023). h = 12.
Every forecast uses only data up to its origin (no look-ahead). The gradient-boosting model is
trained on samples whose targets end at or before the origin. For SYN the boosting model may also
use flight_cycles of the target month, under the documented assumption that the flight
programme is planned in advance.

Usage: python forecast.py <RAF_long.csv> <obj1_synthetic_demand.csv> <generator.py> <out_dir>
"""
import sys, json, importlib.util, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

raf_path, syn_path, gen_path, out = sys.argv[1:5]
ALPHA = 0.1  # smoothing constant for SES/Croston/SBA/TSB (same as the dataset author's baselines)


# ------------------------------------------------------------------ classical methods
def ses(y, a=ALPHA):
    l = y[0]
    for v in y[1:]:
        l += a * (v - l)
    return l


def croston(y, a=ALPHA, sba=False):
    nz = np.flatnonzero(y)
    if len(nz) == 0:
        return 0.0
    z, p, q = y[nz[0]], nz[0] + 1.0, 1
    for t in range(nz[0] + 1, len(y)):
        if y[t] > 0:
            z += a * (y[t] - z); p += a * (q - p); q = 1
        else:
            q += 1
    f = z / p
    return f * (1 - a / 2) if sba else f


def tsb(y, a=ALPHA, b=ALPHA):
    nz = np.flatnonzero(y)
    if len(nz) == 0:
        return 0.0
    z, pr = y[nz].mean(), len(nz) / len(y)
    for v in y:
        if v > 0:
            z += a * (v - z); pr += b * (1 - pr)
        else:
            pr += b * (0 - pr)
    return z * pr


def classical(Y, origin, h, seasonal=False):
    """Y: series x time array. Returns dict method -> (series x h) forecasts made at `origin`."""
    tr = Y[:, :origin]
    rep = lambda v: np.repeat(np.asarray(v, float)[:, None], h, 1)
    f = {
        'Zero (always 0)': rep(np.zeros(len(Y))),
        'Naive (last month)': rep(tr[:, -1]),
        'Moving average 12m': rep(tr[:, -12:].mean(1)),
        'SES': rep([ses(y) for y in tr]),
        'Croston': rep([croston(y) for y in tr]),
        'SBA': rep([croston(y, sba=True) for y in tr]),
        'TSB': rep([tsb(y) for y in tr]),
    }
    if seasonal:  # same month last year
        f['Seasonal naive (12m)'] = np.stack([tr[:, origin - 12 + (k % 12)] for k in range(h)], 1)
    return f


# ------------------------------------------------------------------ gradient boosting (global model)
def features(Y, T, k, extra=None):
    """Features for target month T+k (0-based index T+k-1) using history Y[:, :T]."""
    H = Y[:, :T]
    nz = H > 0
    last_nz = np.where(nz.any(1), T - 1 - np.argmax(nz[:, ::-1], 1), -1)
    with np.errstate(invalid='ignore', divide='ignore'):
        size = np.where(nz.sum(1) > 0, H.sum(1) / nz.sum(1), 0.0)
    cols = {
        'k': np.full(len(Y), k),
        **{f'lag{i}': H[:, T - i] for i in range(1, 13)},
        'ma3': H[:, -3:].mean(1), 'ma6': H[:, -6:].mean(1), 'ma12': H[:, -12:].mean(1),
        'ma24': H[:, -24:].mean(1), 'mean_all': H.mean(1),
        'nzrate12': nz[:, -12:].mean(1), 'nzrate24': nz[:, -24:].mean(1), 'nzrate_all': nz.mean(1),
        'mean_size': size, 'since_last': np.where(last_nz >= 0, T - last_nz, T + 1),
        'max12': H[:, -12:].max(1),
    }
    X = pd.DataFrame(cols)
    if extra is not None:
        X = pd.concat([X, extra(T, k)], axis=1)
    return X


def train_gbm(Y, origin, h, extra, params, first_origin=24, stride=1, seed=0):
    Xs, ys = [], []
    for T in range(first_origin, origin, stride):
        for k in range(1, h + 1):
            if T + k > origin:
                break
            Xs.append(features(Y, T, k, extra)); ys.append(Y[:, T + k - 1])
    X = pd.concat(Xs, ignore_index=True); y = np.concatenate(ys)
    cat = [c for c in X.columns if not pd.api.types.is_numeric_dtype(X[c])]
    for c in cat:
        X[c] = X[c].astype('category')
    m = HistGradientBoostingRegressor(loss='poisson', random_state=seed,
                                      categorical_features=cat if cat else 'from_dtype', **params)
    m.fit(X, y)
    return m, cat


def predict_gbm(m, cat, Y, origin, h, extra):
    F = np.zeros((len(Y), h))
    for k in range(1, h + 1):
        X = features(Y, origin, k, extra)
        for c in cat:
            X[c] = X[c].astype('category')
        F[:, k - 1] = m.predict(X)
    return F


# ------------------------------------------------------------------ metrics
def metrics(F, A, train):
    e = F - A
    d = np.diff(train, axis=1)
    s_abs = np.abs(d).mean(1)
    s_sq = (d ** 2).mean(1)
    ok = s_abs > 0
    cf, ca = F.sum(1), A.sum(1)
    return {
        'MAE': np.abs(e).mean(),
        'RMSE': np.sqrt((e ** 2).mean()),
        'MASE': (np.abs(e).mean(1)[ok] / s_abs[ok]).mean(),
        'RMSSE': np.sqrt((e ** 2).mean(1)[ok] / s_sq[ok]).mean(),
        'Bias (ME)': e.mean(),
        'Forecast/Actual total': cf.sum() / ca.sum() if ca.sum() > 0 else np.nan,
        'Coverage % (sum fcst >= sum demand)': 100 * (cf >= ca).mean(),
    }


def evaluate(Y, origin, h, seasonal, extra, params, stride):
    fc = classical(Y, origin, h, seasonal)
    m, cat = train_gbm(Y, origin, h, extra, params, stride=stride)
    fc['Gradient boosting (Poisson)'] = predict_gbm(m, cat, Y, origin, h, extra)
    A, tr = Y[:, origin:origin + h], Y[:, :origin]
    return fc, A, tr


GBM_GRID = [
    dict(max_iter=150, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=200, l2_regularization=1.0),
    dict(max_iter=400, learning_rate=0.03, max_leaf_nodes=31, min_samples_leaf=100, l2_regularization=1.0),
]


def run(name, Y, val_origin, test_origin, h, seasonal, extra, stride, groups=None, extra_fc=None):
    # 1) choose boosting settings on the validation window (RMSSE), never touching the test window
    val_scores = []
    for p in GBM_GRID:
        m, cat = train_gbm(Y, val_origin, h, extra, p, stride=stride)
        F = predict_gbm(m, cat, Y, val_origin, h, extra)
        val_scores.append(metrics(F, Y[:, val_origin:val_origin + h], Y[:, :val_origin])['RMSSE'])
    best = GBM_GRID[int(np.argmin(val_scores))]
    # 2) validation table (all methods) and test table, refitting on everything up to the origin
    tables = {}
    for split, origin in [('validation', val_origin), ('test', test_origin)]:
        fc, A, tr = evaluate(Y, origin, h, seasonal, extra, best, stride)
        if extra_fc is not None:
            fc.update(extra_fc(origin, h))
        rows = [{'method': k, **metrics(v, A, tr)} for k, v in fc.items()]
        tables[split] = pd.DataFrame(rows)
        if split == 'test':
            test_fc, test_A, test_tr = fc, A, tr
    by_group = None
    if groups is not None:
        rows = []
        for g in np.unique(groups):
            mk = groups == g
            for k, v in test_fc.items():
                rows.append({'group': g, 'method': k, **metrics(v[mk], test_A[mk], test_tr[mk])})
        by_group = pd.DataFrame(rows)
    return tables, by_group, {'gbm_val_RMSSE_per_setting': val_scores, 'gbm_chosen': best}


results = {}
writer = pd.ExcelWriter(f'{out}/forecast_results.xlsx', engine='openpyxl')

# ================================================================== RAF
raf = pd.read_csv(raf_path)
Yr = raf.pivot(index='series_id', columns='month_index', values='demand_qty').values.astype(float)
cls = pd.read_csv(f'{out}/raf_series_classes.csv', index_col=0)['class'].values
t_r, g_r, info_r = run('RAF', Yr, 72, 78, 6, False, None, stride=2, groups=cls)
for s, t in t_r.items():
    t.round(4).to_excel(writer, sheet_name=f'RAF_{s}', index=False)
g_r.round(4).to_excel(writer, sheet_name='RAF_test_by_SBC_class', index=False)
results['RAF'] = {**info_r, 'test': t_r['test'].round(4).to_dict(orient='records'),
                  'validation': t_r['validation'].round(4).to_dict(orient='records')}

# ================================================================== Synthetic
syn = pd.read_csv(syn_path)
syn['date'] = pd.to_datetime(syn.period_start_date, format='%d-%m-%Y')
syn = syn.sort_values(['part_id', 'location_id', 'date'])
keys = syn[['part_id', 'location_id', 'part_class']].drop_duplicates().reset_index(drop=True)
Ys = syn.pivot_table(index=['part_id', 'location_id'], columns='date', values='demand_quantity').values.astype(float)
FC = syn.pivot_table(index=['part_id', 'location_id'], columns='date', values='flight_cycles').values.astype(float)
months = np.array(sorted(syn.date.unique()))


def syn_extra(T, k):
    t = T + k - 1  # target index
    hist_fc = FC[:, :T].mean(1)
    return pd.DataFrame({
        'part_class': keys.part_class.values.astype(object),
        'location': keys.location_id.values.astype(object),
        'target_month': pd.DatetimeIndex([months[t]]).month[0] * np.ones(len(keys), int),
        'fc_rel_target': FC[:, t] / hist_fc,
    })


# Oracle: the generator's own expected demand given the true parameters and realised flight cycles.
# Not a usable forecaster (it knows the hidden parameters); it marks the best achievable average error.
spec = importlib.util.spec_from_file_location('gen', gen_path); gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)
parts = gen.build_parts(np.random.default_rng(42)).set_index('part_id')
fcb = parts.loc[keys.part_id, 'flight_cycles_base'].values.astype(float)
p0 = np.array([gen.CLASS_PARAMS[c]['p_zero'] for c in keys.part_class])
lam = np.array([gen.CLASS_PARAMS[c]['lam'] for c in keys.part_class])


def oracle(origin, h):
    sl = FC[:, origin:origin + h]
    return {'Oracle (true generator mean; reference only)':
            (1 - p0)[:, None] * np.maximum(0.05, lam[:, None] * sl / fcb[:, None])}


t_s, g_s, info_s = run('SYN', Ys, 48, 60, 12, True, syn_extra, stride=1,
                       groups=keys.part_class.values, extra_fc=oracle)
for s, t in t_s.items():
    t.round(4).to_excel(writer, sheet_name=f'SYN_{s}', index=False)
g_s.round(4).to_excel(writer, sheet_name='SYN_test_by_part_class', index=False)
results['SYN'] = {**info_s, 'test': t_s['test'].round(4).to_dict(orient='records'),
                  'validation': t_s['validation'].round(4).to_dict(orient='records')}
writer.close()

json.dump(results, open(f'{out}/forecast_results.json', 'w'), indent=1, default=float)
pd.set_option('display.width', 250)
for n, t in [('RAF test', t_r['test']), ('RAF validation', t_r['validation']),
             ('SYN test', t_s['test']), ('SYN validation', t_s['validation'])]:
    print(f'\n===== {n}'); print(t.round(3).to_string(index=False))
print('\n===== RAF test by SBC class'); print(g_r.round(3).to_string(index=False))
print('\n===== SYN test by part class'); print(g_s.round(3).to_string(index=False))
print('\nGBM choice:', info_r, info_s)
