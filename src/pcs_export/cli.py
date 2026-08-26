from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import typer

from .client import PCSClient
from .config import Settings
from .exporter import export_facility
from .writer import write_json
from .validation import validate_run

app = typer.Typer(no_args_is_help=True)


def _client(settings: Settings, facility: str) -> PCSClient:
    return PCSClient(settings.base_url, facility, settings.company_id, verify=settings.verify_ssl, timeout=settings.timeout_seconds)


def _date(value: str, option: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise typer.BadParameter(f"{option} must use YYYY-MM-DD format") from exc


@app.command()
def inventory(out: Path = Path("exports/inventory.json")) -> None:
    """Verify read-only access and save company/facility metadata."""
    settings = Settings.from_env()
    result = []
    for facility in settings.facility_ids:
        api = _client(settings, facility)
        result.append({"facilityHeader": facility, "company": api.get("/company"), "facilities": api.get("/facilities", {"Page": 1, "Size": settings.page_size})})
    write_json(out, result)
    typer.echo(f"Wrote {out}")


@app.command("probe-order")
def probe_order(
    order_id: int = typer.Option(..., min=1, help="PCS order ID to inspect"),
    out: Path = typer.Option(Path("exports/order-probe"), help="Directory for probe output"),
) -> None:
    """Fetch one order and every documented read-only order subresource."""
    settings = Settings.from_env()
    for facility_index, facility in enumerate(settings.facility_ids, 1):
        api = _client(settings, facility)
        facility_out = out / str(order_id) / f"facility-{facility_index}"
        manifest = {
            "orderId": order_id,
            "readOnly": True,
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "resources": {},
        }
        resources = {
            "detail": f"/orders/{order_id}",
            "customer": f"/orders/{order_id}/customer",
            "items": f"/orders/{order_id}/items",
            "party": f"/orders/{order_id}/party",
            "guestsofhonor": f"/orders/{order_id}/guestsofhonor",
        }
        for name, path in resources.items():
            try:
                payload = api.get(path)
                write_json(facility_out / f"{name}.json", payload)
                manifest["resources"][name] = {
                    "ok": True,
                    "responseType": type(payload).__name__,
                    "empty": payload is None or payload == [] or payload == {},
                }
            except Exception as exc:
                manifest["resources"][name] = {
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
        manifest["completedAt"] = datetime.now(timezone.utc).isoformat()
        write_json(facility_out / "manifest.json", manifest)
        typer.echo(f"Wrote {facility_out}")


@app.command("probe-order-number")
def probe_order_number(
    order_number: int = typer.Option(..., min=1, help="Customer-facing PCS order number"),
    out: Path = typer.Option(Path("exports/order-probe"), help="Directory for probe output"),
) -> None:
    """Resolve a customer-facing order number and probe all order resources."""
    settings = Settings.from_env()
    matches: list[dict] = []
    for facility in settings.facility_ids:
        api = _client(settings, facility)
        payload = api.get("/orders", {"OrderNumber": order_number, "Page": 1, "Size": 10})
        if isinstance(payload, dict):
            rows = payload.get("items") or payload.get("Items") or []
        elif isinstance(payload, list):
            rows = payload
        else:
            rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            returned_number = row.get("orderNumber") or row.get("OrderNumber")
            order_id = row.get("orderId") or row.get("OrderId") or row.get("id") or row.get("Id")
            if str(returned_number) == str(order_number) and order_id:
                matches.append({"orderId": int(order_id), "orderNumber": order_number})
    unique_ids = sorted({row["orderId"] for row in matches})
    if not unique_ids:
        raise typer.BadParameter(f"PCS returned no order for order number {order_number}")
    if len(unique_ids) > 1:
        write_json(out / f"order-number-{order_number}-matches.json", matches)
        raise typer.BadParameter(
            f"Order number {order_number} matched multiple internal IDs: {unique_ids}"
        )
    typer.echo(f"Resolved order number {order_number} to internal order ID {unique_ids[0]}")
    probe_order(order_id=unique_ids[0], out=out)


@app.command("export-all")
def export_all(
    start: str = typer.Option(..., help="First date to export (YYYY-MM-DD)"),
    end: str = typer.Option(..., help="Last date to export (YYYY-MM-DD)"),
    out: Path = Path("exports"),
    run_id: str = typer.Option("", help="Reuse this run ID to resume an interrupted export"),
) -> None:
    """Export all documented PCS API data for every configured facility."""
    start_date = _date(start, "--start")
    end_date = _date(end, "--end")
    if end_date < start_date:
        raise typer.BadParameter("--end must be on or after --start")
    settings = Settings.from_env()
    run_id = run_id.strip() or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if not run_id.replace("-", "").replace("_", "").isalnum():
        raise typer.BadParameter("--run-id may contain only letters, numbers, hyphens, and underscores")
    run_dir = out / run_id
    manifest_path = run_dir / "manifest.json"
    if manifest_path.exists():
        import json
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected_range = {"start": str(start_date), "end": str(end_date)}
        if manifest.get("dateRange") != expected_range:
            raise typer.BadParameter("Existing --run-id uses a different date range")
        typer.echo(f"Resuming export: {run_dir}")
    else:
        manifest = {"runId": run_id, "startedAt": datetime.now(timezone.utc).isoformat(), "readOnly": True, "dateRange": {"start": str(start_date), "end": str(end_date)}, "facilities": {}}
    write_json(manifest_path, manifest)
    for facility_index, facility in enumerate(settings.facility_ids, 1):
        facility_name = f"facility-{facility_index}"
        manifest["facilities"][facility_name] = export_facility(_client(settings, facility), run_dir / facility_name, settings.page_size, start_date, end_date, settings.merchant_ids)
        write_json(manifest_path, manifest)
    manifest["completedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, manifest)
    typer.echo(f"Export complete: {run_dir}")


@app.command("validate-run")
def validate_export_run(
    run_dir: Path = typer.Option(..., exists=True, file_okay=False, help="Completed export run directory"),
) -> None:
    """Generate the reporting issue queue for an export run."""
    issues = validate_run(run_dir)
    high = sum(1 for issue in issues if issue["priority"] == "High")
    typer.echo(f"Flagged {len(issues)} issues ({high} high priority)")
    typer.echo(f"Wrote {run_dir.parent / 'reporting' / run_dir.name}")


if __name__ == "__main__":
    app()
