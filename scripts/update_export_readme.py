#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Update the PCS export history README")
    parser.add_argument("exports_dir", nargs="?", type=Path, default=Path("exports"))
    args = parser.parse_args()

    rows = []
    for manifest_path in sorted(args.exports_dir.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if "dateRange" not in manifest:
            continue
        run_dir = manifest_path.parent
        facility = manifest.get("facilities", {}).get("facility-1", {})
        state = read_state(run_dir / ".watch_state.json")
        started = datetime.fromisoformat(manifest["startedAt"])
        completed_raw = manifest.get("completedAt")
        ended = datetime.fromisoformat(completed_raw) if completed_raw else datetime.now(started.tzinfo)
        elapsed_minutes = max((ended - started).total_seconds() / 60, 1 / 60)
        orders = facility.get("orders", state.get("orders", ""))
        pages = count_pages(run_dir / "facility-1" / "pages" / "orders")
        rows.append(
            {
                "run": manifest.get("runId", run_dir.name),
                "range": f"{manifest['dateRange']['start']} to {manifest['dateRange']['end']}",
                "status": "Complete" if completed_raw else "Running",
                "started": started.astimezone().strftime("%Y-%m-%d %H:%M %Z"),
                "completed": ended.astimezone().strftime("%Y-%m-%d %H:%M %Z") if completed_raw else "—",
                "elapsed": duration((ended - started).total_seconds()),
                "customers": facility.get("customers", ""),
                "products": facility.get("products", ""),
                "orders": orders,
                "pages": pages,
                "failures": facility.get("orderSubresourceFailures", ""),
                "rate": f"{int(orders) / elapsed_minutes:.1f}" if orders != "" else "",
            }
        )

    output = args.exports_dir / "README.md"
    output.write_text(render(rows), encoding="utf-8")
    print(f"Wrote {output}")


def read_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def count_pages(path: Path) -> int:
    return sum(1 for _ in path.glob("page-*.jsonl")) if path.exists() else 0


def duration(seconds: float) -> str:
    total = max(int(seconds), 0)
    hours, remainder = divmod(total, 3600)
    minutes, _ = divmod(remainder, 60)
    return f"{hours}h {minutes:02d}m"


def render(rows: list[dict]) -> str:
    lines = [
        "# PCS Export History",
        "",
        "Generated from each run's manifest and progress state. Re-run `python scripts/update_export_readme.py` after a yearly export completes.",
        "",
        "| Run | Date range | Status | Started | Completed | Elapsed | Customers | Products | Orders | Order pages | Failures | Orders/min |",
        "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            "| {run} | {range} | {status} | {started} | {completed} | {elapsed} | {customers} | {products} | {orders} | {pages} | {failures} | {rate} |".format(**row)
        )
    lines.extend(
        [
            "",
            "Notes:",
            "",
            "- Customers and products are full reference-table snapshots and may repeat between yearly runs.",
            "- Orders are filtered by the run's date range.",
            "- A run is final only when its status is `Complete` and failures have been reviewed.",
            "",
        ]
    )
    return "\n".join(lines)


if __name__ == "__main__":
    main()
