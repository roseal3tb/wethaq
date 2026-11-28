# What the first arm64 figures measure, and what they do not

This note goes with `../github-arm64-2026-11-28/` (run 46166121729, 28 November 2026, GitHub-hosted `ubuntu-24.04-arm` runner, Arm Neoverse-N2, 4 vCPU, 16 GB). Those figures came from a GitHub-hosted runner, **not from Oracle hardware**. They are not figures from a 2 OCPU / 12 GB Ampere A1 instance.

## Memory and CPU (`resources.txt`)

| Figure | How it was taken | What it is |
|---|---|---|
| Containers about 330 MiB in total (peers 72 and 82 MiB, orderer 30, CAs about 10 each, chaincode about 30 each, PostgreSQL 56) | One `docker stats --no-stream` sample, **after** the tests had finished | Memory at rest after a test run. **Not peak memory.** |
| API about 49 MB + 136 MB resident | One `ps` sample at the same moment (the `tsx` wrapper and the Node process) | The same: after the tests, at rest |
| Host "used" 1,662 MB | `free -m` at the same moment | Includes the runner's own services, so it is an upper bound for WETHAQ at rest, not WETHAQ alone |
| CPU % | Same single sample | Close to 0 at rest. Says nothing about CPU under load |

## Timings (`SUMMARY.md`, NFR table)

| Figure | How it was taken |
|---|---|
| Ledger writes about 533 to 540 ms on average | 10 sequential workflow runs (request, dispatch, in transit, receipt). The average is per operation type, through the API, endorsed by both peers and ordered |
| 20 concurrent requests in 0.29 s, "68.7 tx/s" | 20 `POST /shipments` (create request) sent at once, each one Fabric transaction. Throughput = 20 ÷ wall time of that burst. It is a burst figure, not a sustained rate |
| Why writes take about 0.5 s | The ordering service's `BatchTimeout` is set to 500 ms by `fabric/up.sh` (line 28). A single write waits for the block to be cut, so most of its time is that timeout, not CPU |

## What changed in the workflow (commit d0835da)

The workflow now records peaks and phases instead of one sample:

- `.github/scripts/sample-resources.sh` samples every 2 seconds: each container (CPU %, MiB), the API process (RSS, CPU %), the host (`free`, load average), and, when limits are on, the cgroup slice (memory.current and CPU % from `cpu.stat`).
- Phase markers: startup, idle (30 s with nothing running), NFR checks, and an extra load phase.
- Extra load phase: `npm run nfr -- --runs 30 --concurrency 50` (30 workflow runs and 50 concurrent requests). It is marked `continue-on-error`, so it records figures without changing the pass/fail result of the main checks.
- `resources-summary.md`: median and peak for each phase, plus peak memory per container.
- `storage.txt`: PostgreSQL data size, peer and orderer ledger sizes, Docker volumes.
- `timings.tsv` from `fabric/up.sh`: time for each network start phase.
- **Optional `a1_limits` input.** When it is ticked, Docker and the API run inside a systemd slice with `CPUQuota=200%`, `MemoryMax=12G` and no swap. That is 2 CPUs and 12 GB in total, which is the size of the planned A1 instance. The workflow checks that `cpu.max` reads `200000 100000` before it starts.

**Status: COMPLETE AND VERIFIED on a GitHub-hosted arm64 runner.** Run 46174686728 (no limit) and run 46174759675 (`a1_limits`) both passed on 28 November 2026. The figures are in [github-runs.md](github-runs.md). Under the limit, WETHAQ peaked at about 531 MiB and about 58 % of one core, and every check passed.

**What the limited run will and will not show.** A 2 CPU / 12 GB limit on a GitHub arm64 runner is still a GitHub runner: the CPU model (Neoverse-N2), disk and network are not those of an Oracle A1 instance (Ampere Altra, Neoverse-N1). It shows whether WETHAQ fits in that amount of CPU and memory. It does not predict the exact timings on Oracle.
