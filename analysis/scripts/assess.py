"""Wethaq Sprint 1/3 — dataset assessment for RAF and the synthetic aviation panel.
Usage: python assess.py <RAF_long.csv> <obj1_synthetic_demand.csv> <out_dir>"""
import sys, json, numpy as np, pandas as pd

raf_path, syn_path, out = sys.argv[1], sys.argv[2], sys.argv[3]


def sbc(y):
    """ADI (mean interval between non-zero periods, Syntetos-Boylan) and CV^2 of non-zero sizes."""
    nz = np.flatnonzero(y)
    if len(nz) == 0:
        return np.nan, np.nan, 'no demand'
    adi = len(y) / len(nz)
    sizes = y[nz]
    cv2 = (sizes.std(ddof=0) / sizes.mean()) ** 2 if len(sizes) > 1 else 0.0
    if adi < 1.32:
        cls = 'Smooth' if cv2 < 0.49 else 'Erratic'
    else:
        cls = 'Intermittent' if cv2 < 0.49 else 'Lumpy'
    return adi, cv2, cls


res = {}

# ---------------- RAF ----------------
raf = pd.read_csv(raf_path)
checks = {
    'rows': len(raf), 'series': raf.series_id.nunique(), 'months': raf.month.nunique(),
    'first_month': raf.month.min(), 'last_month': raf.month.max(),
    'missing_values': int(raf.isna().sum().sum()),
    'negative_values': int((raf.demand_qty < 0).sum()),
    'duplicate_keys': int(raf.duplicated(['series_id', 'month']).sum()),
}
Y = raf.pivot(index='series_id', columns='month_index', values='demand_qty')
checks['all_series_full_length'] = bool(Y.notna().all().all())
Yv = Y.values.astype(float)
checks['zero_share_pct'] = round(100 * (Yv == 0).mean(), 2)
checks['test_zero_share_pct'] = round(100 * (Yv[:, 78:] == 0).mean(), 2)
checks['series_with_test_demand_pct'] = round(100 * (Yv[:, 78:].sum(1) > 0).mean(), 2)
checks['max_monthly_demand'] = int(Yv.max())
checks['total_demand'] = int(Yv.sum())
stats = pd.DataFrame([sbc(y) for y in Yv], columns=['ADI', 'CV2', 'class'], index=Y.index)
stats['nonzero_months'] = (Yv > 0).sum(1)
checks['nonzero_months_min_median_max'] = [int(stats.nonzero_months.min()), int(stats.nonzero_months.median()), int(stats.nonzero_months.max())]
checks['ADI_median'] = round(float(stats.ADI.median()), 2)
checks['CV2_median'] = round(float(stats.CV2.median()), 3)
checks['class_counts'] = stats['class'].value_counts().to_dict()
dup = pd.DataFrame(Yv, index=Y.index)
dmask = dup.duplicated(keep=False)
checks['identical_series'] = list(dup.index[dmask])
# series silent through the whole training window but demanded in test (cold-start-like)
checks['series_zero_in_last_24_train_months'] = int((Yv[:, 54:78].sum(1) == 0).sum())
res['RAF'] = checks
stats.to_csv(f'{out}/raf_series_classes.csv')

# ---------------- Synthetic aviation ----------------
syn = pd.read_csv(syn_path)
syn['date'] = pd.to_datetime(syn.period_start_date, format='%d-%m-%Y')
c = {
    'rows': len(syn), 'columns': syn.shape[1] - 1, 'parts': syn.part_id.nunique(),
    'locations': syn.location_id.nunique(), 'months': syn.date.nunique(),
    'first_month': str(syn.date.min().date()), 'last_month': str(syn.date.max().date()),
    'missing_values': int(syn.drop(columns='date').isna().sum().sum()),
    'duplicate_keys': int(syn.duplicated(['part_id', 'location_id', 'date']).sum()),
    'negative_inventory': int((syn.closing_inventory < 0).sum()),
    'closing_eq_opening_minus_issues': bool((syn.closing_inventory == syn.opening_inventory - syn.issues_quantity).all()),
    'issues_le_demand': bool((syn.issues_quantity <= syn.demand_quantity).all()),
    'stockout_flag_consistent': bool(((syn.issues_quantity < syn.demand_quantity) == (syn.stockout_indicator == 1)).all()),
    'zero_share_pct': round(100 * (syn.demand_quantity == 0).mean(), 2),
    'stockout_rate_pct': round(100 * syn.stockout_indicator.mean(), 2),
    'lead_time_values': sorted(syn.lead_time_days.unique().tolist()),
}
syn = syn.sort_values(['part_id', 'location_id', 'date'])
# lead time is drawn independently every month in the generator: check how often it changes month to month
ch = syn.groupby(['part_id', 'location_id']).lead_time_days.apply(lambda s: (s.diff().fillna(0) != 0).mean())
c['lead_time_changes_month_to_month_pct'] = round(100 * ch.mean(), 1)
# attributes constant per part?
c['aircraft_type_constant_per_part'] = bool((syn.groupby('part_id').aircraft_type.nunique() == 1).all())
c['flight_cycles_same_across_locations'] = bool((syn.groupby(['part_id', 'date']).flight_cycles.nunique() == 1).all())
pc = syn.groupby('part_class').agg(rows=('demand_quantity', 'size'), mean_demand=('demand_quantity', 'mean'),
                                   zero_pct=('demand_quantity', lambda s: 100 * (s == 0).mean()),
                                   stockout_pct=('stockout_indicator', lambda s: 100 * s.mean())).round(2)
c['by_class'] = pc.to_dict(orient='index')
sstats = []
for (p, l), g in syn.groupby(['part_id', 'location_id']):
    a, v, k = sbc(g.demand_quantity.values.astype(float))
    sstats.append({'part_id': p, 'location_id': l, 'part_class': g.part_class.iloc[0], 'ADI': a, 'CV2': v, 'SBC': k})
sstats = pd.DataFrame(sstats)
c['SBC_by_part_class'] = pd.crosstab(sstats.part_class, sstats.SBC).to_dict(orient='index')
# temporal structure: lag-1 autocorrelation of demand within series (i.i.d. generator -> ~0)
ac = syn.groupby(['part_id', 'location_id']).demand_quantity.apply(lambda s: s.autocorr(1)).dropna()
c['median_lag1_autocorrelation'] = round(float(ac.median()), 3)
# correlation of demand with flight cycles (relative to part base) per class
syn['fc_rel'] = syn.flight_cycles / syn.groupby('part_id').flight_cycles.transform('mean')
c['corr_demand_vs_relative_flight_cycles'] = syn.groupby('part_class').apply(lambda g: round(g.demand_quantity.corr(g.fc_rel), 3)).to_dict()
res['Synthetic'] = c
sstats.to_csv(f'{out}/syn_series_classes.csv', index=False)

json.dump(res, open(f'{out}/assessment.json', 'w'), indent=1, default=str)
print(json.dumps(res, indent=1, default=str))
