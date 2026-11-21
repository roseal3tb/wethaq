"""Wethaq Sprint 4 — inventory policy simulation on the synthetic aviation panel (Option A).

Monthly periodic-review simulation; 2022 is a warm-up year and results are measured over the 2023 test year (12 months x 180 part-location series),
lost sales (unmet demand is not back-ordered, as in the generator). Every policy faces the same
realised demand, the same starting stock (the panel's opening inventory in Jan 2022, start of the warm-up) and the same
supplier lead time for an order placed in a given month (the panel's lead_time_days for that
row, converted to whole months exactly as the generator does).

Policies
  Current policy     the generator's own rule: when closing stock <= class reorder point and no order
                     is open, order the class order quantity (fast 8/10, slow 3/10, intermittent 4/20).
  Fixed threshold    (s, S) review: s = mu*P + z*sigma*sqrt(P), S = s + mu, with mu and sigma the
                     series' 2018-2022 monthly mean and standard deviation, fixed for the year.
  Forecast: TSB      same (s, S) rule, but mu is replaced each month by a TSB forecast (alpha 0.1)
                     refreshed with the latest demand.
  Forecast: GB       same rule with the Sprint 3 gradient-boosting model (trained on data to Dec 2022),
                     forecasting each next month from the latest demand and planned flight cycles.
  Oracle mean        same rule with the generator's true expected demand (reference only).
P = protection period = mean lead time (from 2018-2022 rows) + 1 review month. The safety-stock
term z*sigma*sqrt(P) is identical for the four (s, S) policies, so they differ only in the demand
estimate. Inventory position = stock on hand + stock on order; an order lifts it to S.

Usage: python inventory_sim.py <obj1_synthetic_demand.csv> <forecast.py> <generator.py> <sprint3_out_dir> <out_dir>
"""
import sys, json, importlib.util, numpy as np, pandas as pd

syn_path, fc_path, gen_path, s3_dir, out = sys.argv[1:6]
src = open(fc_path, encoding='utf-8').read().split('\nresults = {}')[0].replace('raf_path, syn_path, gen_path, out = sys.argv[1:5]', '')
ns = {}; exec(compile(src, fc_path, 'exec'), ns)
tsb, train_gbm, features = ns['tsb'], ns['train_gbm'], ns['features']
spec = importlib.util.spec_from_file_location('gen', gen_path); gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)

syn = pd.read_csv(syn_path)
syn['date'] = pd.to_datetime(syn.period_start_date, format='%d-%m-%Y')
syn = syn.sort_values(['part_id', 'location_id', 'date'])
keys = syn[['part_id', 'location_id', 'part_class']].drop_duplicates().reset_index(drop=True)
piv = lambda col: syn.pivot_table(index=['part_id', 'location_id'], columns='date', values=col).values.astype(float)
D, FC, LT, OPEN, STOCKOUT = piv('demand_quantity'), piv('flight_cycles'), piv('lead_time_days'), piv('opening_inventory'), piv('stockout_indicator')
months = np.array(sorted(syn.date.unique()))
W0, T0, T1 = 48, 60, 72  # warm-up 2022, measured 2023
N = len(keys)
cls = keys.part_class.values
lt_months = np.vectorize(lambda d: max(1, round(d / 30)))(LT).astype(int)  # same conversion as the generator

mu = D[:, :T0].mean(1)
sigma = D[:, :T0].std(1, ddof=1)
P = lt_months[:, :T0].mean(1) + 1.0
# warm-up year 2022: every (s, S) policy uses the same fixed rule built from 2018-2021 only
mu_w, sigma_w, P_w = D[:, :W0].mean(1), D[:, :W0].std(1, ddof=1), lt_months[:, :W0].mean(1) + 1.0

# ---- demand estimates per month (made at the end of month t-1 for month t, t in 2023)
est = {}
est['Fixed threshold'] = np.repeat(mu[:, None], T1 - T0, 1)
est['Forecast: TSB'] = np.stack([[tsb(D[i, :t]) for t in range(T0, T1)] for i in range(N)])
gbm_params = json.load(open(f'{s3_dir}/forecast_results.json'))['SYN']['gbm_chosen']


def extra(T, k):
    t = T + k - 1
    return pd.DataFrame({'part_class': keys.part_class.values.astype(object), 'location': keys.location_id.values.astype(object),
                         'target_month': pd.DatetimeIndex([months[t]]).month[0] * np.ones(N, int), 'fc_rel_target': FC[:, t] / FC[:, :T].mean(1)})


model, cat = train_gbm(D, T0, 12, extra, gbm_params, stride=1)
gb = np.zeros((N, T1 - T0))
for j, t in enumerate(range(T0, T1)):
    X = features(D, t, 1, extra)
    for c in cat:
        X[c] = X[c].astype('category')
    gb[:, j] = model.predict(X)
est['Forecast: GB'] = gb
parts = gen.build_parts(np.random.default_rng(42)).set_index('part_id')
fcb = parts.loc[keys.part_id, 'flight_cycles_base'].values.astype(float)
p0 = np.array([gen.CLASS_PARAMS[c]['p_zero'] for c in cls]); lam = np.array([gen.CLASS_PARAMS[c]['lam'] for c in cls])
est['Oracle mean (reference)'] = (1 - p0)[:, None] * np.maximum(0.05, lam[:, None] * FC[:, T0:T1] / fcb[:, None])


def simulate(policy, z=1.645):
    stock = OPEN[:, W0].copy()
    pipeline = [[] for _ in range(N)]  # (arrival month index, qty)
    issued = np.zeros((N, T1 - T0)); closing = np.zeros_like(issued); out_flag = np.zeros_like(issued); orders = np.zeros(N)
    for t in range(W0, T1):
        j = t - T0  # negative during warm-up
        for i in range(N):
            if t > W0:  # the first month's opening stock already includes that month's recorded arrivals
                arr = sum(q for (a, q) in pipeline[i] if a == t)
                stock[i] += arr
            pipeline[i] = [(a, q) for (a, q) in pipeline[i] if a > t]
            d = D[i, t]
            iss = min(d, stock[i]); stock[i] -= iss
            if j >= 0:
                issued[i, j] = iss; closing[i, j] = stock[i]; out_flag[i, j] = float(iss < d)
            L = lt_months[i, t]
            if policy == 'Current policy':
                pr = gen.CLASS_PARAMS[cls[i]]
                if stock[i] <= pr['reorder_point'] and not pipeline[i]:
                    pipeline[i].append((t + L, pr['order_qty'])); orders[i] += (j >= 0)
            else:
                if j + 1 < 0:  # warm-up: same fixed rule for every (s, S) policy, 2018-2021 statistics
                    f, sg, PP = mu_w[i], sigma_w[i], P_w[i]
                else:  # estimate for the coming month (index j + 1; the last month reuses its own)
                    f, sg, PP = est[policy][i, min(j + 1, T1 - T0 - 1)], sigma[i], P[i]
                s = f * PP + z * sg * np.sqrt(PP)
                S = s + f
                ip = stock[i] + sum(q for (_, q) in pipeline[i])
                if ip <= s:
                    q = int(np.ceil(S - ip))
                    if q > 0:
                        pipeline[i].append((t + L, q)); orders[i] += (j >= 0)
    return issued, closing, out_flag, orders


def summarise(issued, closing, out_flag, orders, mask=None):
    m = np.ones(N, bool) if mask is None else mask
    dem = D[m, T0:T1]
    return {'fill_rate_pct': 100 * issued[m].sum() / dem.sum(), 'stockout_months_pct': 100 * out_flag[m].mean(),
            'avg_stock_units': closing[m].mean(), 'orders_per_series_year': orders[m].mean(),
            'lost_units': float(dem.sum() - issued[m].sum())}


policies = ['Current policy', 'Fixed threshold', 'Forecast: TSB', 'Forecast: GB', 'Oracle mean (reference)']
head, byclass = [], []
for p in policies:
    r = simulate(p)
    head.append({'policy': p, **summarise(*r)})
    for c in ['fast_moving', 'slow_moving', 'intermittent']:
        byclass.append({'policy': p, 'class': c, **summarise(*r, mask=(cls == c))})
head, byclass = pd.DataFrame(head), pd.DataFrame(byclass)

curve = []
for p in policies[1:]:
    for z in [0.0, 0.5, 1.0, 1.28, 1.645, 2.0, 2.5]:
        curve.append({'policy': p, 'z': z, **summarise(*simulate(p, z))})
curve = pd.DataFrame(curve)

# sanity: the panel's own recorded 2023 outcome under the generator (random order sizes)
recorded = {'stockout_months_pct': 100 * STOCKOUT[:, T0:T1].mean()}

with pd.ExcelWriter(f'{out}/inventory_sim_results.xlsx') as w:
    head.round(3).to_excel(w, sheet_name='policies_z1.645', index=False)
    byclass.round(3).to_excel(w, sheet_name='by_class_z1.645', index=False)
    curve.round(3).to_excel(w, sheet_name='tradeoff_curve', index=False)
json.dump({'headline': head.round(3).to_dict(orient='records'), 'by_class': byclass.round(3).to_dict(orient='records'),
           'curve': curve.round(3).to_dict(orient='records'), 'recorded_2023_stockout_pct': round(recorded['stockout_months_pct'], 2),
           'mean_protection_period_months': round(float(P.mean()), 3)}, open(f'{out}/inventory_sim.json', 'w'), indent=1)
pd.set_option('display.width', 250)
print(head.round(2).to_string(index=False))
print(byclass.round(2).to_string(index=False))
print(curve.round(2).to_string(index=False))
print('recorded 2023 stockout months % in panel:', round(recorded['stockout_months_pct'], 2), ' mean P', round(float(P.mean()), 2))
