from datetime import date

from pcs_export.exporter import _windows


def test_two_day_windows_cover_range_without_overlap():
    assert list(_windows(date(2026, 8, 1), date(2026, 8, 5))) == [
        (date(2026, 8, 1), date(2026, 8, 2)),
        (date(2026, 8, 3), date(2026, 8, 4)),
        (date(2026, 8, 5), date(2026, 8, 5)),
    ]
