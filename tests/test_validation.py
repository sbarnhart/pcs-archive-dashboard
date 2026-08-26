import json
from pathlib import Path

from pcs_export.validation import validate_run


def test_cancelled_order_with_balance_is_flagged(tmp_path: Path):
    run = tmp_path / "run-1"
    order_dir = run / "facility-1" / "orders" / "42"
    order_dir.mkdir(parents=True)
    (run / "manifest.json").write_text(
        json.dumps({"runId": "run-1", "facilities": {"facility-1": {}}}), encoding="utf-8"
    )
    (order_dir / "detail.json").write_text(
        json.dumps({"orderId": 42, "orderNumber": 99, "status": 2, "balanceDue": 21, "totalPayments": 0}),
        encoding="utf-8",
    )
    issues = validate_run(run)
    assert len(issues) == 1
    assert issues[0]["issueType"] == "cancelled_order_nonzero_balance"
    assert issues[0]["priority"] == "Medium"
