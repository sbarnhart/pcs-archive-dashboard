from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    base_url: str
    facility_ids: tuple[str, ...]
    company_id: str
    verify_ssl: bool
    page_size: int
    timeout_seconds: float
    merchant_ids: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        many = os.getenv("PCS_FACILITY_IDS", "")
        one = os.getenv("PCS_FACILITY_ID", "")
        facilities = tuple(x.strip() for x in (many or one).split(",") if x.strip())
        if not facilities:
            raise ValueError("Set PCS_FACILITY_ID or PCS_FACILITY_IDS")
        merchants = tuple(x.strip() for x in os.getenv("PCS_MERCHANT_IDS", "").split(",") if x.strip())
        return cls(
            base_url=os.getenv("PCS_API_BASE_URL", "https://api.partycs.com").rstrip("/"),
            facility_ids=facilities,
            company_id=os.getenv("PCS_COMPANY_ID", "636"),
            verify_ssl=_bool(os.getenv("PCS_VERIFY_SSL", "true")),
            page_size=int(os.getenv("PCS_PAGE_SIZE", "100")),
            timeout_seconds=float(os.getenv("PCS_TIMEOUT_SECONDS", "60")),
            merchant_ids=merchants,
        )
