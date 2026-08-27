from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .client import PCSClient
from .writer import write_json, write_jsonl


def _stamp(day: date, *, end: bool = False) -> str:
    value = datetime.combine(day, time.max if end else time.min, tzinfo=timezone.utc)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _local_stamp(day: date, *, end: bool = False) -> str:
    """Format a facility-local report timestamp without a UTC offset.

    PCS closeout/detail explicitly treats these values as facility-local and
    performs no timezone conversion.
    """
    value = datetime.combine(day, time.max if end else time.min)
    return value.isoformat(timespec="milliseconds")


def _missing_or_null(path: Path) -> bool:
    if not path.exists():
        return True
    return path.read_text(encoding="utf-8").strip() in {"", "null"}


def _windows(start: date, end: date, days: int = 2):
    cursor = start
    while cursor <= end:
        window_end = min(cursor + timedelta(days=days - 1), end)
        yield cursor, window_end
        cursor = window_end + timedelta(days=1)


def export_facility(client: PCSClient, out: Path, page_size: int, start: date, end: date, merchants: tuple[str, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    company_path = out / "company.json"
    if not company_path.exists():
        write_json(company_path, client.get("/company"))
    failures: list[dict[str, Any]] = []

    def export_order_resources(order: dict[str, Any]) -> None:
        order_id = order.get("id") or order.get("orderId") or order.get("Id") or order.get("OrderId")
        if not order_id:
            return
        resources = (("", "detail"), ("/customer", "customer"), ("/guestsofhonor", "guestsofhonor"), ("/items", "items"), ("/party", "party"))
        for suffix, name in resources:
            resource_path = out / "orders" / str(order_id) / f"{name}.json"
            if resource_path.exists():
                continue
            try:
                write_json(resource_path, client.get(f"/orders/{order_id}{suffix}"))
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404 and name in {"customer", "party", "guestsofhonor"}:
                    # These relationships are optional. PCS uses 404 rather than
                    # an empty JSON value when an order has no related record.
                    write_json(resource_path, None)
                    continue
                failures.append({"orderId": order_id, "resource": name, "error": f"{type(exc).__name__}: {exc}"})
            except Exception as exc:
                failures.append({"orderId": order_id, "resource": name, "error": f"{type(exc).__name__}: {exc}"})

    for entity in ("facilities", "customers", "products", "orders"):
        counts[entity] = 0
        params = None
        if entity == "orders":
            params = {"OrderDateStart": _stamp(start), "OrderDateEnd": _stamp(end, end=True), "Sort": "orderId_asc"}
        page_dir = out / "pages" / entity
        completed_pages = sorted(page_dir.glob("page-*.jsonl"))
        for page_path in completed_pages:
            with page_path.open(encoding="utf-8") as handle:
                for line in handle:
                    counts[entity] += 1
                    if entity == "orders":
                        export_order_resources(json.loads(line))
        start_page = len(completed_pages) + 1
        for page, rows in client.indexed_pages(
            f"/{entity}", page_size=page_size, params=params, start_page=start_page
        ):
            counts[entity] += write_jsonl(page_dir / f"page-{page:06d}.jsonl", rows)
            if entity == "orders":
                for order in rows:
                    export_order_resources(order)
    for window_start, window_end in _windows(start, end):
        window_key = f"{window_start}_{window_end}"
        booking_dates = {"startDate": _stamp(window_start), "endDate": _stamp(window_end, end=True)}
        for name in ("new", "executed"):
            report_path = out / "reports" / f"bookings_{name}" / f"{window_key}.json"
            if not report_path.exists():
                write_json(report_path, client.get(f"/reports/bookings/{name}", booking_dates))
        report_dates = {
            "startDateTime": _local_stamp(window_start),
            "endDateTime": _local_stamp(window_end, end=True),
        }
        closeout_path = out / "reports" / "closeout_detail" / f"{window_key}.json"
        if _missing_or_null(closeout_path):
            write_json(
                closeout_path,
                client.report("/reports/closeout/detail", {**report_dates, "includeNonTerminals": True}),
            )
        if merchants:
            body = {
                "merchantIdentifiers": list(merchants),
                "transactionsStartDate": _stamp(window_start),
                "transactionsEndDate": _stamp(window_end, end=True),
                "timezone": "America/Los_Angeles",
            }
            for endpoint in ("funding", "fundingdetail"):
                report_path = out / "reports" / f"pcpay_{endpoint}" / f"{window_key}.json"
                if not report_path.exists():
                    write_json(report_path, client.report(f"/reports/pcpay/{endpoint}", body))
    write_jsonl(out / "errors" / "order_subresources.jsonl", failures)
    counts["orderSubresourceFailures"] = len(failures)
    return counts
