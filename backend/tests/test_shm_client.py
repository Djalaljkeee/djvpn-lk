"""Проброс клиентских заголовков в серверные вызовы SHM.

SHM 3.x привязывает сессию к User-Agent, с которым она создана. Бэкенд ЛК
проверяет сессию сам (security.py → shm_request), поэтому обязан слать UA
браузера, иначе SHM отвечает 401 и фронт уходит в цикл /login.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

import shm_client
from logging_config import client_ip_ctx, client_ua_ctx


UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Mobile/15E148"


def test_proxy_headers_include_client_ua_and_ip() -> None:
    ip_t = client_ip_ctx.set("203.0.113.7")
    ua_t = client_ua_ctx.set(UA)
    try:
        assert shm_client._proxy_headers() == {
            "X-Forwarded-For": "203.0.113.7",
            "X-Real-IP": "203.0.113.7",
            "User-Agent": UA,
        }
    finally:
        client_ip_ctx.reset(ip_t)
        client_ua_ctx.reset(ua_t)


def test_proxy_headers_empty_outside_request() -> None:
    assert shm_client._proxy_headers() == {}


def test_shm_request_sends_browser_ua(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["ua"] = req.headers.get("user-agent")
        seen["cookie"] = req.headers.get("cookie")
        return httpx.Response(200, json={"data": [{"user_id": 42}]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(shm_client, "get_shm_client", lambda: client)

    async def run() -> dict:
        ua_t = client_ua_ctx.set(UA)
        try:
            return await shm_client.shm_request("GET", "/shm/v1/user", "sid123")
        finally:
            client_ua_ctx.reset(ua_t)
            await client.aclose()

    data = asyncio.run(run())
    assert data["data"][0]["user_id"] == 42
    assert seen["ua"] == UA
    assert seen["cookie"] == "session_id=sid123"


def test_storage_fetch_sends_browser_ua(monkeypatch: pytest.MonkeyPatch) -> None:
    import storage

    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["ua"] = req.headers.get("user-agent")
        return httpx.Response(200, text='{"subscriptionUrl": "https://sub/x"}')

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(storage, "get_shm_client", lambda: client)

    async def run():
        ua_t = client_ua_ctx.set(UA)
        try:
            return await storage.fetch_sub_url_from_storage(193, "sid123", 2)
        finally:
            client_ua_ctx.reset(ua_t)
            await client.aclose()

    assert asyncio.run(run()) == "https://sub/x"
    assert seen["ua"] == UA
