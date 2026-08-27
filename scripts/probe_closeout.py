from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pcs_export.client import PCSClient
from pcs_export.config import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe the read-only PCS closeout transaction report.")
    parser.add_argument("--start", required=True, help="Facility-local start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="Facility-local end date (YYYY-MM-DD)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--window-days", type=int, default=2)
    args = parser.parse_args()

    settings = Settings.from_env()
    results = []
    for index, facility in enumerate(settings.facility_ids, 1):
        client = PCSClient(
            settings.base_url,
            facility,
            settings.company_id,
            verify=settings.verify_ssl,
            timeout=settings.timeout_seconds,
        )
        rows = []
        cursor = date.fromisoformat(args.start)
        end = date.fromisoformat(args.end)
        while cursor <= end:
            window_end = min(cursor + timedelta(days=args.window_days - 1), end)
            payload = client.report("/reports/closeout/detail", {
                "startDateTime": f"{cursor}T00:00:00",
                "endDateTime": f"{window_end}T23:59:59.999",
                "includeNonTerminals": True,
            })
            if isinstance(payload, list):
                rows.extend(payload)
            cursor = window_end + timedelta(days=1)
        payload = rows
        facility_out = args.out / f"facility-{index}.json"
        facility_out.parent.mkdir(parents=True, exist_ok=True)
        facility_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        results.append({
            "facility": index,
            "responseType": type(payload).__name__,
            "transactions": len(rows),
            "fields": sorted(rows[0]) if rows and isinstance(rows[0], dict) else [],
            "output": str(facility_out),
        })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
