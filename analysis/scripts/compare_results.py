"""Compares a reproduced run (run_all.sh's out/) with the reference copies in results/.
Usage: python3 compare_results.py <reference dir, e.g. results> <reproduced dir, e.g. out>
Every number is compared; differences above a relative tolerance of 1e-6 are listed, as are structural differences.
Exit code 1 when anything differs."""
import json, math, sys
pairs = [('assessment.json','assessment.json'),('forecast_results.json','forecast_results.json'),('raf-forecasts.json','raf-forecasts.json'),
         ('raf_rolling.json','sprint4/raf_rolling.json'),('inventory_sim.json','sprint4/inventory_sim.json')]
ref_dir, out_dir = sys.argv[1], sys.argv[2]
def walk(a, b, p, acc):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b: acc['structure'].append(f'{p}.{k}: only in {"reference" if k in a else "reproduced"}'); continue
            walk(a[k], b[k], f'{p}.{k}', acc)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): acc['structure'].append(f'{p}: length {len(a)} vs {len(b)}'); return
        for i, (x, y) in enumerate(zip(a, b)): walk(x, y, f'{p}[{i}]', acc)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        acc['numbers'] += 1
        d = abs(a - b); r = d / max(abs(a), abs(b), 1e-12)
        if d == 0: acc['identical'] += 1
        elif d <= 1e-9 or r <= 1e-6: acc['within_1e-6'] += 1
        else: acc['diffs'].append((r, d, p, a, b))
    else:
        if a != b: acc['other'].append(f'{p}: {str(a)[:60]!r} vs {str(b)[:60]!r}')
failed = False
for ref, out in pairs:
    a = json.load(open(f'{ref_dir}/{ref}')); b = json.load(open(f'{out_dir}/{out}'))
    acc = {'numbers': 0, 'identical': 0, 'within_1e-6': 0, 'diffs': [], 'structure': [], 'other': []}
    walk(a, b, '$', acc)
    acc['diffs'].sort(reverse=True)
    print(f'== {ref}: {acc["numbers"]} numbers, {acc["identical"]} identical, {acc["within_1e-6"]} within 1e-6 relative, {len(acc["diffs"])} differ; structure differences {len(acc["structure"])}; other differences {len(acc["other"])}')
    for r, d, p, x, y in acc['diffs'][:8]: print(f'   {p}: reference {x} reproduced {y} (relative {r:.2e})')
    for s in acc['structure'][:5]: print('   structure', s)
    for s in acc['other'][:8]: print('   other', s)
    failed = failed or bool(acc['diffs'] or acc['structure'] or acc['other'])
print('RESULT:', 'differences found' if failed else 'the reproduced results match the reference copies')
sys.exit(1 if failed else 0)
