"""Smoke-тесты системных эндпоинтов."""


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_metrics_format(client):
    # Делаем один API-запрос, чтобы метрика уж точно была >= 1
    client.get("/api/config")
    r = client.get("/metrics")
    assert r.status_code == 200
    body = r.text
    assert "http_requests_total" in body
    assert "http_request_duration_seconds" in body


def test_config_endpoint_exposes_telegram_bot(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    assert "telegram_bot_username" in r.json()


def test_maintenance_default_disabled(client):
    r = client.get("/api/system/maintenance")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert isinstance(body.get("message", ""), str)


def test_cart_requires_auth(client):
    r = client.get("/api/user/cart")
    assert r.status_code == 401
