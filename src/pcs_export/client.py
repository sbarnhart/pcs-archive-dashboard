from __future__ import annotations

import time
from typing import Any, Iterator

import httpx

GET_PATHS = {
    "/company", "/customers", "/facilities", "/orders", "/products",
    "/reports/bookings/executed", "/reports/bookings/new",
}
ORDER_SUFFIXES = {"", "/customer", "/guestsofhonor", "/items", "/party"}
REPORT_POST_PATHS = {
    "/reports/closeout/detail", "/reports/pcpay/funding", "/reports/pcpay/fundingdetail"
}


class PCSClient:
    def __init__(self, base_url: str, facility_id: str, company_id: str, *, verify: bool, timeout: float):
        self.base_url = base_url
        self.headers = {
            "pcs-facility-id": facility_id,
            "pcs-company-id": company_id,
            "accept": "application/json",
            "user-agent": "pcs-full-export/0.1 (read-only)",
        }
        self.http = httpx.Client(verify=verify, timeout=timeout, headers=self.headers)

    @staticmethod
    def _allowed_get(path: str) -> bool:
        if path in GET_PATHS:
            return True
        if path.startswith("/orders/"):
            parts = path.split("/")
            suffix = "/" + "/".join(parts[3:]) if len(parts) > 3 else ""
            return bool(parts[2]) and suffix in ORDER_SUFFIXES
        return False

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        if method == "GET" and not self._allowed_get(path):
            raise ValueError(f"GET path is not on the read-only allowlist: {path}")
        if method == "POST" and path not in REPORT_POST_PATHS:
            raise ValueError(f"POST path is not an approved read-only report: {path}")
        if method not in {"GET", "POST"}:
            raise ValueError(f"Mutating HTTP method is prohibited: {method}")
        for attempt in range(8):
            response = self.http.request(method, self.base_url + path, **kwargs)
            if response.status_code not in {429, 500, 502, 503, 504}:
                response.raise_for_status()
                if not response.content or not response.text.strip():
                    return None
                try:
                    return response.json()
                except ValueError:
                    # Some PCS endpoints return successful plain-text responses
                    # or omit the JSON content type. Preserve the response rather
                    # than treating a successful read as a failed request.
                    return response.text
            time.sleep(min(2**attempt, 30))
        response.raise_for_status()

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self._request("GET", path, params=params)

    def report(self, path: str, body: dict[str, Any]) -> Any:
        return self._request("POST", path, json=body)

    def pages(self, path: str, *, page_size: int, params: dict[str, Any] | None = None) -> Iterator[list[Any]]:
        for _, items in self.indexed_pages(path, page_size=page_size, params=params):
            yield items

    def indexed_pages(
        self,
        path: str,
        *,
        page_size: int,
        params: dict[str, Any] | None = None,
        start_page: int = 1,
    ) -> Iterator[tuple[int, list[Any]]]:
        page = start_page
        while True:
            query = {**(params or {}), "Page": page, "Size": page_size}
            payload = self.get(path, query)
            items = payload.get("items") or payload.get("Items") or []
            if not items:
                return
            yield page, items
            total = payload.get("totalItems") or payload.get("TotalItems")
            if len(items) < page_size or (total is not None and page * page_size >= int(total)):
                return
            page += 1
