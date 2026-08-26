#!/usr/bin/env bash
set -uo pipefail

ARCHIVE_VERSION="1.0"
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

mark_progress "ALL" "FINALIZING" "validation" "validating every yearly export"
for year in $(seq "$START_YEAR" "$END_YEAR"); do
  run_id="year-${year}-through-${year}-12-31"
  mark_progress "$year" "VALIDATING" "$run_id" "building reporting issue queue"
  if pcs-export validate-run --run-dir "$EXPORT_ROOT/$run_id"; then
    mark_progress "$year" "VALIDATED" "$run_id" "reporting issue queue complete"
  else
    exit_code=$?
    mark_progress "$year" "FAILED" "$run_id" "validation exit code $exit_code"
    exit "$exit_code"
  fi
done

mark_progress "ALL" "FINALIZING" "export-history" "updating exports/README.md"
if ! python3 scripts/update_export_readme.py; then
  mark_progress "ALL" "FAILED" "export-history" "could not update exports/README.md"
  exit 1
fi

mark_progress "ALL" "FINALIZING" "dashboard" "rebuilding archive dashboard workbook"
if ! node scripts/build_dashboard.mjs; then
  mark_progress "ALL" "FAILED" "dashboard" "dashboard build failed"
  exit 1
fi

mark_progress "ALL" "DASHBOARD_READY" "dashboard-output/PCS Archive Dashboard.xlsx" \
  "exports validated, history updated, dashboard rebuilt — PCS ARCHIVE v$ARCHIVE_VERSION"

printf '\nAll exports from %s through %s are complete and the dashboard is rebuilt.\n' "$START_YEAR" "$END_YEAR"
printf 'Progress log: %s\n' "$PROGRESS_FILE"
printf 'Dashboard: dashboard-output/PCS Archive Dashboard.xlsx\n'
