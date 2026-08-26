from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .writer import write_jsonl


def validate_run(run_dir: Path) -> list[dict[str, Any]]:
    """Build a reporting issue queue from one completed export run."""
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    detected_at = datetime.now(timezone.utc).isoformat()
    issues: list[dict[str, Any]] = []
    for facility_name in sorted(manifest.get("facilities", {})):
        order_root = run_dir / facility_name / "orders"
        for detail_path in sorted(order_root.glob("*/detail.json")):
            order = json.loads(detail_path.read_text(encoding="utf-8"))
            status = order.get("statusCode", order.get("status"))
            balance = float(order.get("balanceDue") or 0)
            if status == 2 and abs(balance) > 0.005:
                payments = float(order.get("totalPayments") or 0)
                order_id = order.get("orderId") or order.get("id")
                order_number = order.get("orderNumber")
                issues.append(
                    {
                        "issueId": f"cancelled-balance-{order_id}",
                        "facility": facility_name,
                        "recordType": "order",
                        "recordId": order_id,
                        "orderNumber": order_number,
                        "issueType": "cancelled_order_nonzero_balance",
                        "description": f"Cancelled order has a remaining balance of {balance:.2f}",
                        "balanceDue": round(balance, 2),
                        "orderTotal": order.get("orderTotal"),
                        "totalPayments": order.get("totalPayments"),
                        "cancelDate": order.get("cancelDate"),
                        "sourceLastUpdated": order.get("lastUpdated"),
                        "detectedAt": detected_at,
                        "sourceRunId": manifest.get("runId"),
                        "status": "New",
                        "priority": "High" if payments else "Medium",
                        "assignedTo": "",
                        "resolutionNotes": "",
                        "resolvedAt": "",
                        "verifiedRunId": "",
                    }
                )
    issues.sort(key=lambda row: (row["priority"] != "High", row["orderNumber"] or 0))
    output_dir = run_dir.parent / "reporting" / manifest["runId"]
    write_jsonl(output_dir / "issues.jsonl", issues)
    _write_csv(output_dir / "issues.csv", issues)
    return issues


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0]) if rows else ["issueId"]
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temp.replace(path)
