"""Checks analysis/results against results/MANIFEST.json without the datasets (used in CI): every result file must
have the recorded SHA-256, and every script that produced it must be unchanged since. Exit code 1 otherwise.
Usage: python3 check_manifest.py [results dir] [scripts dir]"""
import hashlib, json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
results = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', 'results')
scripts = sys.argv[2] if len(sys.argv) > 2 else here
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
manifest = json.load(open(os.path.join(results, 'MANIFEST.json')))
problems = []
for name, entry in manifest['results'].items():
    path = os.path.join(results, name)
    if not os.path.isfile(path): problems.append(f'{name}: missing'); continue
    if sha(path) != entry['sha256']: problems.append(f'{name}: differs from the manifest (changed after the results were produced)')
    for script in entry.get('scripts', []):
        if sha(os.path.join(scripts, script)) != manifest['scripts'][script]:
            problems.append(f'{name}: {script} changed after these results were produced (run run_all.sh again and rewrite the manifest)')
for p in problems: print('PROBLEM', p)
print(f"{len(manifest['results'])} result files checked against MANIFEST.json written {manifest.get('writtenAt')}: {'ok' if not problems else f'{len(problems)} problems'}")
sys.exit(1 if problems else 0)
