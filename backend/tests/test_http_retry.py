"""Тесты connect-уровневого ретрая (http_retry.request_with_connect_retry).

Поведение, которое проверяем:
  - connect-сбой (ConnectTimeout/ConnectError/PoolTimeout) повторяется и при
    последующем успехе возвращается нормальный ответ;
  - после исчерпания попыток пробрасывается последнее исключение;
  - ReadTimeout НЕ ретраится (запрос мог быть уже отправлен → небезопасно);
  - успех с первой попытки не плодит лишних вызовов.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

import http_retry
from http_retry import request_with_connect_retry


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    # Убираем реальные паузы джиттера — тесты должны быть мгновенными.
    monkeypatch.setattr(http_retry, "_BACKOFF_BASE_S", 0.0)


class _FakeClient:
    """Падает первые `fail_times` вызовов заданным исключением, затем 200."""

    def __init__(self, fail_times: int, exc: BaseException) -> None:
        self.fail_times = fail_times
        self.exc = exc
        self.calls = 0

    async def request(self, method, url, **kwargs):  # noqa: D401 - mimic httpx
        self.calls += 1
        if self.calls <= self.fail_times:
            raise self.exc
        return httpx.Response(200, content=b"ok")


def _run(client, method="GET"):
    return asyncio.run(
        request_with_connect_retry(client, method, "http://x", label="t")
    )


def test_retries_connect_timeout_then_succeeds() -> None:
    client = _FakeClient(fail_times=1, exc=httpx.ConnectTimeout("boom"))
    resp = _run(client)
    assert resp.status_code == 200
    assert client.calls == 2  # 1 fail + 1 success


def test_retries_connect_error() -> None:
    client = _FakeClient(fail_times=1, exc=httpx.ConnectError("boom"))
    resp = _run(client)
    assert resp.status_code == 200
    assert client.calls == 2


def test_gives_up_after_max_attempts() -> None:
    client = _FakeClient(fail_times=99, exc=httpx.PoolTimeout("boom"))
    with pytest.raises(httpx.PoolTimeout):
        _run(client)
    assert client.calls == http_retry._MAX_RETRIES + 1


def test_read_timeout_not_retried() -> None:
    # ReadTimeout = запрос уже мог уйти на сервер → повтор небезопасен.
    client = _FakeClient(fail_times=99, exc=httpx.ReadTimeout("boom"))
    with pytest.raises(httpx.ReadTimeout):
        _run(client, method="POST")
    assert client.calls == 1


def test_first_attempt_success_no_retry() -> None:
    client = _FakeClient(fail_times=0, exc=httpx.ConnectTimeout("boom"))
    resp = _run(client)
    assert resp.status_code == 200
    assert client.calls == 1
