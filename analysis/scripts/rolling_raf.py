"""Wethaq Sprint 4 — rolling-origin evaluation on RAF and smoothing-constant tuning.

Four non-overlapping 6-month test windows: origins at months 60, 66, 72 and 78 (forecasting months
61-66, 67-72, 73-78 and 79-84). Every forecast uses only data up to its origin.

Tuning: for SES, Croston, SBA and TSB the smoothing constant is chosen from {0.05, 0.1, 0.2, 0.3}
on the three earlier windows (mean RMSSE) and then applied, unchanged, to the final window
(origin 78). Gradient boosting keeps the settings chosen in Sprint 3.

Usage: python rolling_raf.py <RAF_long.csv> <forecast.py> <sprint3_out_dir> <out_dir>
"""
import sys, json, numpy as np, pandas as pd

raf_path, fc_path, s3_dir, out = sys.argv[1:5]
src = open(fc_path, encoding='utf-8').read().split('\nresults = {}')[0].replace('raf_path, syn_path, gen_path, out = sys.argv[1:5]', '')
ns = {}; exec(compile(src, fc_path, 'exec'), ns)
ses, croston, tsb, metrics, train_gbm, predict_gbm = ns['ses'], ns['croston'], ns['tsb'], ns['metrics'], ns['train_gbm'], ns['predict_gbm']
gbm_params = json.load(open(f'{s3_dir}/forecast_results.json'))['RAF']['gbm_chosen']

raf = pd.read_csv(raf_path)
Y = raf.pivot(index='series_id', columns='month_index', values='demand_qty').values.astype(float)
H, ORIGINS, ALPHAS = 6, [60, 66, 72, 78], [0.05, 0.1, 0.2, 0.3]
rep = lambda v: np.repeat(np.asarray(v, float)[:, None], H, 1)


def smooth_forecasts(origin, a):
    tr = Y[:, :origin]
    return {'SES': rep([ses(y, a) for y in tr]), 'Croston': rep([croston(y, a) for y in tr]),
            'SBA': rep([croston(y, a, sba=True) for y in tr]), 'TSB': rep([tsb(y, a, a) for y in tr])}


rows = []
cache = {}
for o in ORIGINS:
    A, tr = Y[:, o:o + H], Y[:, :o]
    base = {'Zero (always 0)': rep(np.zeros(len(Y))), 'Naive': rep(tr[:, -1]), 'Moving average 12m': rep(tr[:, -12:].mean(1))}
    m, cat = train_gbm(Y, o, H, None, gbm_params, stride=2)
    base['Gradient boosting'] = predict_gbm(m, cat, Y, o, H, None)
    for k, F in base.items():
        rows.append({'origin': o, 'method': k, 'alpha': None, **metrics(F, A, tr)})
    for a in ALPHAS:
        for k, F in smooth_forecasts(o, a).items():
            rows.append({'origin': o, 'method': k, 'alpha': a, **metrics(F, A, tr)})
    print('origin', o, 'done', flush=True)

df = pd.DataFrame(rows)
df.to_csv(f'{out}/raf_rolling_all.csv', index=False)

# tuning on the first three windows
tune = df[(df.origin < 78) & df.alpha.notna()].groupby(['method', 'alpha']).RMSSE.mean().reset_index()
best_alpha = tune.loc[tune.groupby('method').RMSSE.idxmin()].set_index('method').alpha.to_dict()

# summary 1: mean over all four windows with alpha = 0.1 (Sprint 3 setting)
fixed = df[(df.alpha.isna()) | (df.alpha == 0.1)]
summary = fixed.groupby('method')[['MAE', 'RMSE', 'MASE', 'RMSSE', 'Bias (ME)', 'Forecast/Actual total', 'Coverage % (sum fcst >= sum demand)']].agg(['mean', 'min', 'max'])
# summary 2: final window with tuned alpha vs alpha 0.1
final = []
for meth in ['SES', 'Croston', 'SBA', 'TSB']:
    for lab, a in [('alpha 0.1', 0.1), ('tuned', best_alpha[meth])]:
        r = df[(df.origin == 78) & (df.method == meth) & (df.alpha == a)].iloc[0]
        final.append({'method': meth, 'setting': lab, 'alpha': a, **{k: r[k] for k in ['MAE', 'RMSSE', 'Bias (ME)', 'Forecast/Actual total', 'Coverage % (sum fcst >= sum demand)']}})
final = pd.DataFrame(final)
# per-window ranks by RMSSE (alpha 0.1), excluding the zero forecast
rk = fixed[fixed.method != 'Zero (always 0)'].copy()
rk['rank_RMSSE'] = rk.groupby('origin').RMSSE.rank()
rk['rank_cov'] = rk.groupby('origin')['Coverage % (sum fcst >= sum demand)'].rank(ascending=False)
ranks = rk.pivot(index='method', columns='origin', values='rank_RMSSE')
cov_ranks = rk.pivot(index='method', columns='origin', values='rank_cov')

with pd.ExcelWriter(f'{out}/raf_rolling_results.xlsx') as w:
    summary.round(4).to_excel(w, sheet_name='mean_4_windows_alpha0.1')
    fixed.round(4).to_excel(w, sheet_name='per_window_alpha0.1', index=False)
    tune.round(4).to_excel(w, sheet_name='alpha_tuning_windows1-3', index=False)
    final.round(4).to_excel(w, sheet_name='final_window_tuned', index=False)
    ranks.to_excel(w, sheet_name='RMSSE_rank_per_window')

json.dump({'best_alpha': best_alpha, 'origins': ORIGINS,
           'summary_mean': {m: {c[0]: round(float(summary.loc[m, c]), 4) for c in summary.columns if c[1] == 'mean'} for m in summary.index},
           'summary_min': {m: {c[0]: round(float(summary.loc[m, c]), 4) for c in summary.columns if c[1] == 'min'} for m in summary.index},
           'summary_max': {m: {c[0]: round(float(summary.loc[m, c]), 4) for c in summary.columns if c[1] == 'max'} for m in summary.index},
           'final_tuned': final.round(4).to_dict(orient='records'),
           'rmsse_rank_per_window': ranks.to_dict(), 'coverage_rank_per_window': cov_ranks.to_dict()},
          open(f'{out}/raf_rolling.json', 'w'), indent=1, default=float)
pd.set_option('display.width', 250)
print(summary.xs('mean', axis=1, level=1).round(3).to_string())
print('\nbest alpha', best_alpha)
print(final.round(3).to_string(index=False))
print('\nRMSSE rank per window\n', ranks.to_string())
print('\ncoverage rank per window\n', cov_ranks.to_string())
print('\nper-window table')
print(fixed[['origin', 'method', 'MAE', 'RMSSE', 'Forecast/Actual total', 'Coverage % (sum fcst >= sum demand)']].round(3).to_string(index=False))
