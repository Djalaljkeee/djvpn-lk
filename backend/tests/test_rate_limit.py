"""Rate-limit проверяем, что slowapi отдает 429 после превышения."""

from unittest.mock import patch


class _FakeResp:
    status_code = 502
    content = b""
    text = "mock"
    headers: dict = {}
    cookies: dict = {}


async def _fake_get(*args, **kwargs):
    return _FakeResp()


def test_captcha_rate_limit_triggers_429(client):
    """11-й запрос к /api/captcha должен получить 429."""

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.get = _fake_get
        statuses = [client.get("/api/captcha").status_code for _ in range(12)]

    # Первые 10 — прошли (SHM 502 по моку), далее 429
    assert statuses.count(429) >= 1
    assert statuses[0] != 429


def test_rate_limit_isolates_per_forwarded_ip(client):
    """X-Forwarded-For должен разводить квоты разных клиентов.

    Без ProxyHeadersMiddleware все запросы из docker-сети летели бы под одним
    ключом (IP nginx-контейнера) и один шумный клиент блокировал бы всех.
    """

    # IP из TEST-NET-1 (RFC 5737) — не пересекается с другими тестами.
    ip_a = "192.0.2.10"
    ip_b = "192.0.2.20"

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.get = _fake_get

        statuses_a = [
            client.get("/api/captcha", headers={"X-Forwarded-For": ip_a}).status_code
            for _ in range(12)
        ]
        status_b = client.get(
            "/api/captcha", headers={"X-Forwarded-For": ip_b}
        ).status_code

    # IP A исчерпал свою квоту — где-то после 10-го должен быть 429.
    assert statuses_a.count(429) >= 1, (
        f"IP A не получил 429 — лимитер не сработал. statuses={statuses_a}"
    )
    # IP B свежий — его не должно затронуть.
    assert status_b != 429, (
        f"IP B получил 429 — лимитер не различает клиентов по X-Forwarded-For "
        f"(status={status_b})"
    )
