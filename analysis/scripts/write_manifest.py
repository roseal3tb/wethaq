"""Writes MANIFEST.json next to the analysis results: the SHA-256 of each result file, of the scripts that
produced it and of the input datasets, with the Python and package versions of the run. The API uses it to
label each served result as verified, modified (the file changed after the manifest was written) or outdated
(a script changed after the results were produced). Usage:
    python3 write_manifest.py <results dir> <Wethaq_Datasets folder> <scripts dir>
Result files are looked up in <results dir> and in <results dir>/sprint4 (the layout of run_all.sh's out/)."""
import hashlib, json, os, platform, sys
from datetime import datetime, timezone
from importlib import metadata

results_dir, data_dir, scripts_dir = sys.argv[1:4]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
RESULTS = {
    'assessment.json': ['assess.py'],
    'forecast_results.json': ['forecast.py'],
    'raf-forecasts.json': ['raf_export.py', 'forecast.py'],
    'raf_rolling.json': ['rolling_raf.py', 'forecast.py'],
    'inventory_sim.json': ['inventory_sim.py', 'forecast.py'],
}
DATASETS = [
    '01_RAF_Spare_Parts_Demand/Data/RAF_long.csv',
    '04_Optional_Extras/A_Synthetic_Aviation_Demand_12960/obj1_synthetic_demand.csv',
    '04_Optional_Extras/A_Synthetic_Aviation_Demand_12960/generate_obj1_synthetic_demand.py',
]

def find(name):
    for d in (results_dir, os.path.join(results_dir, 'sprint4')):
        if os.path.isfile(os.path.join(d, name)): return os.path.join(d, name)
    sys.exit(f'Missing result file: {name}')

def version(pkg):
    try: return metadata.version(pkg)
    except metadata.PackageNotFoundError: return None

manifest = {
    'writtenAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'python': platform.python_version(),
    'packages': {p: version(p) for p in ('pandas', 'numpy', 'scikit-learn', 'openpyxl')},
    'datasets': [{'file': f, 'sha256': sha(os.path.join(data_dir, f))} for f in DATASETS],
    'scripts': {s: sha(os.path.join(scripts_dir, s)) for s in sorted({s for v in RESULTS.values() for s in v})},
    'results': {name: {'sha256': sha(find(name)), 'bytes': os.path.getsize(find(name)), 'scripts': scripts} for name, scripts in RESULTS.items()},
}
out = os.path.join(results_dir, 'MANIFEST.json')
json.dump(manifest, open(out, 'w'), indent=2)
print(f'wrote {out}')
