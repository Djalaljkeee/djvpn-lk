"""Rate-limit проверяем, что slowapi отдает 429 после превышения."""

from unittest.mock import patch


def test_captcha_rate_limit_triggers_429(client):
    """11-й запрос к /api/captcha должен получить 429."""

    class _FakeResp:
        status_code = 502
        content = b""
        text = "mock"
        headers: dict = {}
        cookies: dict = {}

    async def _fake_get(*args, **kwargs):
        return _FakeResp()

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.get = _fake_get
        statuses = [client.get("/api/captcha").status_code for _ in range(12)]

    # Первые 10 — прошли (SHM 502 по моку), далее 429
    assert statuses.count(429) >= 1
    assert statuses[0] != 429
