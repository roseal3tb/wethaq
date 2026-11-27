#!/usr/bin/env bash
# Reproduce the Wethaq forecasting and inventory results (Sprints 3-4).
# Usage: bash run_all.sh <path to Wethaq_Datasets folder>
set -euo pipefail

DATA="${1:?Give the path to the Wethaq_Datasets folder}"
HERE="$(cd "$(dirname "$0")" && pwd)"
S="$HERE/scripts"
OUT="$HERE/out"

RAF="$DATA/01_RAF_Spare_Parts_Demand/Data/RAF_long.csv"
SYN="$DATA/04_Optional_Extras/A_Synthetic_Aviation_Demand_12960/obj1_synthetic_demand.csv"
GEN="$DATA/04_Optional_Extras/A_Synthetic_Aviation_Demand_12960/generate_obj1_synthetic_demand.py"

for f in "$RAF" "$SYN" "$GEN"; do [ -f "$f" ] || { echo "Missing: $f"; exit 1; }; done
mkdir -p "$OUT/sprint4" "$OUT/ablation"

echo "1/8 Dataset assessment and demand classes"
python3 "$S/assess.py" "$RAF" "$SYN" "$OUT" > "$OUT/assessment.log"

echo "2/8 Forecasting: Naive, MA12, SES, Croston, SBA, TSB, gradient boosting"
python3 "$S/forecast.py" "$RAF" "$SYN" "$GEN" "$OUT"

echo "3/8 Ablation: gradient boosting without flight cycles"
cp "$OUT/raf_series_classes.csv" "$OUT/ablation/"
python3 "$S/forecast_ablation_no_flight_cycles.py" "$RAF" "$SYN" "$GEN" "$OUT/ablation"

echo "4/8 Export RAF forecasts for the dashboard"
python3 "$S/raf_export.py" "$RAF" "$OUT" "$S/forecast.py" "$OUT/raf-forecasts.json"

echo "5/8 Rolling-origin RAF evaluation (Sprint 4)"
python3 "$S/rolling_raf.py" "$RAF" "$S/forecast.py" "$OUT" "$OUT/sprint4"

echo "6/8 Inventory policy simulation (Sprint 4)"
python3 "$S/inventory_sim.py" "$SYN" "$S/forecast.py" "$GEN" "$OUT" "$OUT/sprint4"

echo "7/8 Export inventory results for the dashboard"
python3 "$S/inventory_export.py" "$OUT/sprint4/inventory_sim.json" "$OUT/inventory-sim.json"

echo "8/8 Checksums of the results, scripts and datasets (MANIFEST.json)"
python3 "$S/write_manifest.py" "$OUT" "$DATA" "$S"

echo "Done. Results are in $OUT. Compare them with the reference copies:"
echo "  python3 $S/compare_results.py $HERE/results $OUT"
