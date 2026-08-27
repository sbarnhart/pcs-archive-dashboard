from datetime import date

from pathlib import Path

from pcs_export.exporter import _local_stamp, _missing_or_null, _windows


def test_two_day_windows_cover_range_without_overlap():
    assert list(_windows(date(2026, 8, 1), date(2026, 8, 5))) == [
        (date(2026, 8, 1), date(2026, 8, 2)),
        (date(2026, 8, 3), date(2026, 8, 4)),
        (date(2026, 8, 5), date(2026, 8, 5)),
    ]


def test_closeout_timestamp_is_facility_local_without_utc_suffix():
    assert _local_stamp(date(2026, 8, 1)) == "2026-08-01T00:00:00.000"
    assert _local_stamp(date(2026, 8, 1), end=True) == "2026-08-01T23:59:59.999"


def test_null_closeout_file_is_refetched(tmp_path: Path):
    path = tmp_path / "closeout.json"
    assert _missing_or_null(path)
    path.write_text("null\n", encoding="utf-8")
    assert _missing_or_null(path)
    path.write_text("[]\n", encoding="utf-8")
    assert not _missing_or_null(path)
