#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Show PCS export progress and rates")
    parser.add_argument("run_dir", type=Path)
    args = parser.parse_args()

    manifest_path = args.run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    started = datetime.fromisoformat(manifest["startedAt"])
    now = datetime.now(started.tzinfo)
    elapsed_seconds = max((now - started).total_seconds(), 1)
    elapsed_minutes = elapsed_seconds / 60

    facility = args.run_dir / "facility-1"
    page_count = sum(1 for _ in (facility / "pages" / "orders").glob("page-*.jsonl"))
    orders_path = facility / "orders"
    result = subprocess.run(
        ["find", str(orders_path), "-mindepth", "1", "-maxdepth", "1", "-type", "d", "-printf", "."],
        check=True,
        capture_output=True,
        text=True,
    )
    order_count = len(result.stdout)
    state_path = args.run_dir / ".watch_state.json"
    previous = {}
    if state_path.exists():
        try:
            previous = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
    now_epoch = time.time()
    sample_seconds = now_epoch - float(previous.get("timestamp", now_epoch))
    if sample_seconds >= 1:
        recent_page_rate = (page_count - int(previous.get("pages", page_count))) * 60 / sample_seconds
        recent_order_rate = (order_count - int(previous.get("orders", order_count))) * 60 / sample_seconds
    else:
        recent_page_rate = recent_order_rate = None
    state_path.write_text(
        json.dumps({"timestamp": now_epoch, "pages": page_count, "orders": order_count}),
        encoding="utf-8",
    )
    complete = "completedAt" in manifest

    print(f"Run:              {manifest.get('runId')}")
    print(f"Start time:       {started.astimezone().strftime('%Y-%m-%d %I:%M:%S %p %Z')}")
    print(f"Current time:     {now.astimezone().strftime('%Y-%m-%d %I:%M:%S %p %Z')}")
    print(f"Elapsed:          {format_duration(elapsed_seconds)}")
    print(f"Status:           {'COMPLETE' if complete else 'RUNNING'}")
    print()
    print(f"Order pages:      {page_count:,}")
    print(f"Pages/min avg:    {page_count / elapsed_minutes:,.2f}")
    print(f"Pages/min recent: {format_rate(recent_page_rate)}")
    print()
    print(f"Orders processed: {order_count:,}")
    print(f"Orders/min avg:   {order_count / elapsed_minutes:,.2f}")
    print(f"Orders/min recent:{format_rate(recent_order_rate):>9}")


def format_duration(seconds: float) -> str:
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def format_rate(value: float | None) -> str:
    return "waiting for next sample" if value is None else f"{value:,.2f}"


if __name__ == "__main__":
    main()
