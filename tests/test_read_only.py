import pytest
import httpx

from pcs_export.client import PCSClient


def client() -> PCSClient:
    return PCSClient("https://example.invalid", "facility", "company", verify=True, timeout=1)


def test_documented_gets_are_allowed():
    assert client()._allowed_get("/customers")
    assert client()._allowed_get("/orders/123/items")


def test_unknown_and_mutating_requests_are_rejected_before_network():
    with pytest.raises(ValueError):
        client()._request("DELETE", "/customers/123")
    with pytest.raises(ValueError):
        client()._request("POST", "/orders", json={})
    with pytest.raises(ValueError):
        client()._request("GET", "/admin")


@pytest.mark.parametrize(
    ("content", "expected"),
    [(b"", None), (b"PCS company", "PCS company")],
)
def test_successful_empty_and_plain_text_responses_are_preserved(monkeypatch, content, expected):
    api = client()
    response = httpx.Response(200, content=content, request=httpx.Request("GET", "https://example.invalid/company"))
    monkeypatch.setattr(api.http, "request", lambda *args, **kwargs: response)
    assert api.get("/company") == expected
