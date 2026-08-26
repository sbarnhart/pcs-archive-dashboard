#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path


START_YEAR = 2014
END_YEAR = 2024


def main() -> None:
    parser = argparse.ArgumentParser(description="Continuously watch the 2014-2024 PCS exports")
    parser.add_argument("--interval", type=int, default=30, help="Refresh interval in seconds")
    parser.add_argument("--once", action="store_true", help="Print one snapshot and exit")
    args = parser.parse_args()

    try:
        while True:
            if not args.once:
                os.system("cls" if os.name == "nt" else "clear")
            render(Path("exports"))
            if args.once:
                return
            print(f"\nRefreshing every {args.interval}s. Press Ctrl+C to stop the watcher.")
            time.sleep(max(args.interval, 5))
    except KeyboardInterrupt:
        print("\nWatcher stopped. The exports continue running.")


def render(exports_dir: Path) -> None:
    print("PCS ARCHIVE — v1.0 | yearly export watch — 2014 through 2024")
    print(datetime.now().astimezone().strftime("Updated %Y-%m-%d %I:%M:%S %p %Z"))
    print()
    print(f"{'Year':<6} {'Status':<10} {'Pages':>8} {'Orders':>10} {'Elapsed':>10}")
    print("-" * 50)

    complete = running = pending = 0
    for year in range(START_YEAR, END_YEAR + 1):
        run_id = f"year-{year}-through-{year}-12-31"
        run_dir = exports_dir / run_id
        manifest = read_json(run_dir / "manifest.json")

        if not manifest:
            status = "PENDING"
            pages = orders = 0
            elapsed = "—"
            pending += 1
        else:
            status = "COMPLETE" if manifest.get("completedAt") else "RUNNING"
            pages = count_pages(run_dir / "facility-1" / "pages" / "orders")
            orders = count_orders(run_dir / "facility-1" / "orders")
            elapsed = elapsed_time(manifest)
            if status == "COMPLETE":
                complete += 1
            else:
                running += 1

        print(f"{year:<6} {status:<10} {pages:>8,} {orders:>10,} {elapsed:>10}")

    print("-" * 50)
    print(f"Complete: {complete}   Running: {running}   Pending: {pending}")

    progress_file = exports_dir / "yearly-export-progress.tsv"
    if progress_file.exists():
        lines = progress_file.read_text(encoding="utf-8").splitlines()
        recent = lines[-5:] if len(lines) > 1 else []
        if recent:
            print("\nMost recent markers:")
            for line in recent:
                print("  " + line)


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def count_pages(path: Path) -> int:
    return sum(1 for _ in path.glob("page-*.jsonl")) if path.exists() else 0


def count_orders(path: Path) -> int:
    return sum(1 for item in path.iterdir() if item.is_dir()) if path.exists() else 0


def elapsed_time(manifest: dict) -> str:
    try:
        started = datetime.fromisoformat(manifest["startedAt"])
        ended = datetime.fromisoformat(manifest["completedAt"]) if manifest.get("completedAt") else datetime.now(started.tzinfo)
    except (KeyError, TypeError, ValueError):
        return "—"
    seconds = max(int((ended - started).total_seconds()), 0)
    hours, remainder = divmod(seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}"


if __name__ == "__main__":
    main()
