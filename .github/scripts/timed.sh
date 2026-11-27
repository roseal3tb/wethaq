#!/usr/bin/env bash
# Runs a command and appends "<label><TAB><seconds><TAB><exit code>" to $EVIDENCE/timings.tsv.
#   .github/scripts/timed.sh <label> <command> [<argument> ...]
# The command's own exit code is returned, so a failing command still fails the step.
set -u
label=$1; shift
mkdir -p "${EVIDENCE:?EVIDENCE must be set}"
start=$(date +%s.%N)
"$@"
code=$?
end=$(date +%s.%N)
awk -v l="$label" -v s="$start" -v e="$end" -v c="$code" 'BEGIN { printf "%s\t%.1f\t%d\n", l, e - s, c }' >> "$EVIDENCE/timings.tsv"
exit "$code"
