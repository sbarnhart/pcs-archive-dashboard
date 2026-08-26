#!/usr/bin/env bash
set -uo pipefail

START_YEAR=2014
END_YEAR=2024
EXPORT_ROOT="exports"
PROGRESS_FILE="$EXPORT_ROOT/yearly-export-progress.tsv"

mkdir -p "$EXPORT_ROOT"

if [[ ! -f "$PROGRESS_FILE" ]]; then
  printf 'timestamp\tyear\tstatus\trun_id\tdetails\n' > "$PROGRESS_FILE"
fi

mark_progress() {
  local year="$1"
  local status="$2"
  local run_id="$3"
  local details="$4"
  local timestamp
  timestamp="$(date --iso-8601=seconds)"
  printf '%s\t%s\t%s\t%s\t%s\n' "$timestamp" "$year" "$status" "$run_id" "$details" \
    | tee -a "$PROGRESS_FILE"
}

is_complete() {
  local manifest="$1"
  [[ -f "$manifest" ]] || return 1
  python3 - "$manifest" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if manifest.get("completedAt") else 1)
PY
}

for year in $(seq "$START_YEAR" "$END_YEAR"); do
  run_id="year-${year}-through-${year}-12-31"
  run_dir="$EXPORT_ROOT/$run_id"
  manifest="$run_dir/manifest.json"

  if is_complete "$manifest"; then
    mark_progress "$year" "SKIPPED" "$run_id" "completed manifest already exists"
    continue
  fi

  mark_progress "$year" "STARTED" "$run_id" "export beginning or resuming"

  if pcs-export export-all \
      --start "${year}-01-01" \
      --end "${year}-12-31" \
      --run-id "$run_id"; then
    if is_complete "$manifest"; then
      mark_progress "$year" "COMPLETE" "$run_id" "manifest completedAt verified"
    else
      mark_progress "$year" "FAILED" "$run_id" "command exited successfully but manifest is incomplete"
      exit 1
    fi
  else
    exit_code=$?
    mark_progress "$year" "FAILED" "$run_id" "pcs-export exit code $exit_code; rerun this script to resume"
    exit "$exit_code"
  fi
done

mark_progress "ALL" "COMPLETE" "2014-2024" "all yearly exports verified"
printf '\nAll exports from %s through %s are complete.\n' "$START_YEAR" "$END_YEAR"
printf 'Progress log: %s\n' "$PROGRESS_FILE"
