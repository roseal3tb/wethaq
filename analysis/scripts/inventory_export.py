"""Export the inventory simulation results for the Wethaq dashboard.

Reads inventory_sim.json (written by inventory_sim.py) and writes the file the Inventory page
reads (src/data/inventory-sim.json). Values are copied without recalculation; the dashboard only
formats them for display.

Usage: python inventory_export.py <inventory_sim.json> <out.json>
"""
import sys, json

src, out_path = sys.argv[1:3]
res = json.load(open(src, encoding='utf-8'))

def row(r):
    return {'policy': r['policy'], 'fill': r['fill_rate_pct'], 'stockoutMonths': r['stockout_months_pct'],
            'avgStock': r['avg_stock_units'], 'ordersPerYear': r['orders_per_series_year'], 'lostUnits': r['lost_units']}

class_names = {'fast_moving': 'Fast-moving', 'slow_moving': 'Slow-moving', 'intermittent': 'Intermittent'}
out = {
    'meta': {
        'data': 'Synthetic aviation panel (supervisor-supplied), 60 parts x 3 locations',
        'period': 'Jan-Dec 2023 (2022 warm-up)',
        'target': 'z = 1.645 (95% cycle service)',
        'protectionPeriodMonths': res['mean_protection_period_months'],
        'source': 'inventory_sim.py, exported by inventory_export.py',
    },
    'headline': [row(r) for r in res['headline']],
    'byClass': [{'class': class_names.get(r['class'], r['class']), **row(r)} for r in res['by_class']],
    'curve': [{'z': r['z'], **row(r)} for r in res['curve']],
}
json.dump(out, open(out_path, 'w', encoding='utf-8'), indent=1)
print('policies', len(out['headline']), 'class rows', len(out['byClass']), 'curve rows', len(out['curve']))
