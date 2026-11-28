#!/usr/bin/env bash
# Samples resource use about every 2 seconds until it is stopped (kill), for the arm64 readiness workflow.
#   .github/scripts/sample-resources.sh <output directory> &
# Writes, one line per sample (UNIX time first):
#   containers.tsv  time, container, CPU % (docker stats, share of one CPU), memory used (MiB)
#   api.tsv         time, API process tree RSS (MiB), API CPU % over the interval (share of one CPU)
#   host.tsv        time, host memory used (MiB, `free`), 1-minute load average
#   slice.tsv       time, memory.current (MiB) and CPU % over the interval of the wethaq.slice cgroup
#                   (only when the run uses the 2 CPU / 12 GB limit)
# Docker's CPU % and memory are per container; host memory includes the runner's own services.
set -u
out=${1:?output directory}
mkdir -p "$out"
tick=$(getconf CLK_TCK)
slice=/sys/fs/cgroup/wethaq.slice
to_mib() { # docker stats sizes such as 72.29MiB, 1.2GiB, 900kB
  awk -v v="$1" 'BEGIN { n = v + 0; u = v; sub(/^[0-9.]+/, "", u)
    f = (u == "GiB" || u == "GB") ? 1024 : (u == "KiB" || u == "kB") ? 1 / 1024 : (u == "B") ? 1 / 1048576 : 1
    printf "%.1f", n * f }'
}
api_pids() { pgrep -f 'src/server.ts' || true; }
prev_api_ticks=""; prev_slice_usec=""; prev_t=""
while true; do
  t=$(date +%s.%N)
  docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null | while IFS=$'\t' read -r name cpu mem; do
    printf '%s\t%s\t%s\t%s\n' "${t%.*}" "$name" "${cpu%\%}" "$(to_mib "${mem%% /*}")"
  done >> "$out/containers.tsv"
  pids=$(api_pids)
  if [ -n "$pids" ]; then
    rss=0; ticks=0
    for p in $pids; do
      r=$(awk '/^VmRSS:/ {print $2}' "/proc/$p/status" 2>/dev/null || echo 0); rss=$((rss + ${r:-0}))
      s=$(awk '{print $14 + $15}' "/proc/$p/stat" 2>/dev/null || echo 0); ticks=$((ticks + ${s:-0}))
    done
    cpu=""
    if [ -n "$prev_api_ticks" ] && [ -n "$prev_t" ]; then
      cpu=$(awk -v a="$ticks" -v b="$prev_api_ticks" -v t1="$t" -v t0="$prev_t" -v k="$tick" 'BEGIN { d = t1 - t0; if (d > 0 && a >= b) printf "%.1f", 100 * (a - b) / k / d }')
    fi
    printf '%s\t%.1f\t%s\n' "${t%.*}" "$(awk -v r="$rss" 'BEGIN { print r / 1024 }')" "$cpu" >> "$out/api.tsv"
    prev_api_ticks=$ticks
  fi
  printf '%s\t%s\t%s\n' "${t%.*}" "$(free -m | awk '/^Mem:/ {print $3}')" "$(cut -d' ' -f1 /proc/loadavg)" >> "$out/host.tsv"
  if [ -r "$slice/memory.current" ]; then
    usec=$(awk '/^usage_usec/ {print $2}' "$slice/cpu.stat")
    cpu=""
    if [ -n "$prev_slice_usec" ] && [ -n "$prev_t" ]; then
      cpu=$(awk -v a="$usec" -v b="$prev_slice_usec" -v t1="$t" -v t0="$prev_t" 'BEGIN { d = t1 - t0; if (d > 0) printf "%.1f", 100 * (a - b) / 1e6 / d }')
    fi
    printf '%s\t%.1f\t%s\n' "${t%.*}" "$(awk -v m="$(cat "$slice/memory.current")" 'BEGIN { print m / 1048576 }')" "$cpu" >> "$out/slice.tsv"
    prev_slice_usec=$usec
  fi
  prev_t=$t
  sleep 2
done
