#!/usr/bin/env python3
"""Summarizes the samples written by sample-resources.sh into Markdown (stdout).

    python3 .github/scripts/summarize-resources.py <samples directory>

phases.tsv in the same directory holds "<UNIX time><TAB><label> start|end" markers written by the workflow; each
labelled window gets its own rows. "all" is every sample. Values are what the samplers saw, nothing is estimated:
container figures come from `docker stats`, the API from /proc, the slice from its cgroup files.
"""
import csv
import os
import statistics
import sys

d = sys.argv[1]


def rows(name):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return [r for r in csv.reader(f, delimiter='\t') if r]


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


windows = {'all': (0, float('inf'))}
opened = {}
for r in rows('phases.tsv'):
    t, label = float(r[0]), r[1]
    name, _, edge = label.rpartition(' ')
    if edge == 'start':
        opened[name] = t
    elif edge == 'end' and name in opened:
        windows[name] = (opened.pop(name), t)

containers = rows('containers.tsv')
api = rows('api.tsv')
host = rows('host.tsv')
sl = rows('slice.tsv')


def within(rs, w):
    return [r for r in rs if w[0] <= float(r[0]) <= w[1]]


def fmt(v, unit=''):
    return '–' if v is None else f'{v:.1f}{unit}'


print('| Window | Samples | Containers memory, sum (MiB) median / peak | Containers CPU %, sum median / peak | '
      'API RSS (MiB) median / peak | API CPU % median / peak | Host memory used (MiB) median / peak | '
      'Slice memory (MiB) peak | Slice CPU % median / peak |')
print('|---|---|---|---|---|---|---|---|---|')
for name, w in windows.items():
    c = within(containers, w)
    by_t = {}
    for r in c:
        s = by_t.setdefault(r[0], [0.0, 0.0])
        s[0] += num(r[3]) or 0
        s[1] += num(r[2]) or 0
    mem = [v[0] for v in by_t.values()]
    cpu = [v[1] for v in by_t.values()]
    a = within(api, w)
    arss = [num(r[1]) for r in a if num(r[1]) is not None]
    acpu = [num(r[2]) for r in a if len(r) > 2 and num(r[2]) is not None]
    h = [num(r[1]) for r in within(host, w) if num(r[1]) is not None]
    s = within(sl, w)
    smem = [num(r[1]) for r in s if num(r[1]) is not None]
    scpu = [num(r[2]) for r in s if len(r) > 2 and num(r[2]) is not None]
    med = lambda xs: statistics.median(xs) if xs else None  # noqa: E731
    mx = lambda xs: max(xs) if xs else None  # noqa: E731
    print(f'| {name} | {len(by_t)} | {fmt(med(mem))} / {fmt(mx(mem))} | {fmt(med(cpu))} / {fmt(mx(cpu))} | '
          f'{fmt(med(arss))} / {fmt(mx(arss))} | {fmt(med(acpu))} / {fmt(mx(acpu))} | {fmt(med(h))} / {fmt(mx(h))} | '
          f'{fmt(mx(smem))} | {fmt(med(scpu))} / {fmt(mx(scpu))} |')

print()
print('Peak memory per container over the whole run (MiB): ', end='')
peak = {}
for r in containers:
    v = num(r[3])
    if v is not None:
        peak[r[1]] = max(peak.get(r[1], 0), v)
print(', '.join(f'{k} {v:.1f}' for k, v in sorted(peak.items(), key=lambda kv: -kv[1])) or '–')
