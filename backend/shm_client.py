"""SHM API client helpers.

После перевода фронта на прямые вызовы SHM (admin.djvpn.ru/shm/v1/)
бэкенд ходит в SHM только для двух целей:
  1. Верификация session_id, прилетевшего в cookie (см. security.py).
  2. Получение subscriptionUrl из storage для генерации VPN-конфига
     (см. storage.py) — теперь под пользовательской сессией.

Admin Basic Auth и регистрация/логин-обёртки удалены — этим занимается фронт.

httpx-клиент держится singleton'ом на весь lifecycle процесса:
создание AsyncClient на каждый запрос не переиспользует keep-alive и
под нагрузкой исчерпывает локальные сокеты — отдельные запросы начинают
висеть на connect() без видимой ошибки. Один клиент с явными `Limits`
и `Timeout` решает обе проблемы и даёт нам понятную точку shutdown.
"""

import logging
from typing import Optional

import httpx
from fastapi import HTTPException

from config import settings
from http_retry import request_with_connect_retry
from logging_config import client_ip_ctx


# Лимиты подобраны под одиночный uvicorn-воркер: 50 одновременных коннектов
# с запасом перекрывают пиковую параллельность (gather по N услугам), а
# keepalive_expiry=30 закрывает идл-соединения раньше, чем SHM/прокси успеют
# их тихо обнулить.
_SHM_LIMITS = httpx.Limits(
    max_connections=50,
    max_keepalive_connections=20,
    keepalive_expiry=30.0,
)
# connect — отдельный, короткий: ошибки сети должны падать быстро.
# read/write — 15с: оставляем существующий бюджет SHM-запросов.
# pool — 5с: если пул исчерпан, лучше быстро вернуть 503, чем копить хвост.
_SHM_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0)

_shm_client: Optional[httpx.AsyncClient] = None

# Счётчик in-flight запросов к SHM (включая shm_request и routers/shm_proxy).
# Логируется heartbeat'ом раз в 30с — если значение растёт и не падает,
# значит SHM upstream залип и пул коннектов забивается.
_shm_in_flight: int = 0


def _shm_inflight_inc() -> None:
    global _shm_in_flight
    _shm_in_flight += 1


def _shm_inflight_dec() -> None:
    global _shm_in_flight
    _shm_in_flight -= 1


def get_shm_in_flight() -> int:
    return _shm_in_flight


def get_shm_client() -> httpx.AsyncClient:
    """Ленивая инициализация singleton-клиента SHM.

    Тот же клиент переиспользуют storage.py и routers/shm_proxy.py —
    у них общий upstream (admin.djvpn.ru/shm/*) и совпадающие сетевые
    характеристики.
    """
    global _shm_client
    if _shm_client is None:
        _shm_client = httpx.AsyncClient(timeout=_SHM_TIMEOUT, limits=_SHM_LIMITS)
    return _shm_client


async def close_shm_client() -> None:
    """Закрывает singleton-клиент SHM. Вызывается из lifespan shutdown."""
    global _shm_client
    if _shm_client is not None:
        await _shm_client.aclose()
        _shm_client = None


def _proxy_headers() -> dict:
    ip = client_ip_ctx.get()
    if not ip:
        return {}
    return {"X-Forwarded-For": ip, "X-Real-IP": ip}


async def shm_request(
    method: str,
    path: str,
    session_id: str,
    json_data: dict = None,
    params: dict = None,
) -> dict:
    """Базовый HTTP-вызов SHM. Авторизуется cookie session_id."""
    url = f"{settings.SHM_BASE_URL}{path}"
    headers = {
        "Content-Type": "application/json",
        **_proxy_headers(),
    }
    cookies = {"session_id": session_id} if session_id else None
    client = get_shm_client()
    _shm_inflight_inc()
    try:
        resp = await request_with_connect_retry(
            client, method, url, label=path,
            headers=headers, cookies=cookies,
            json=json_data, params=params,
        )
    except httpx.TimeoutException as exc:
        # Без этой ветки таймаут до SHM долетал до FastAPI как 500 без
        # detail — вызывающий код в security.py/роутерах не отличал «SHM
        # лёг» от «бизнес-логика 500». 504 + JSON позволяет фронту
        # показать «попробуйте позже» вместо generic-ошибки.
        logging.warning("SHM %s %s upstream_error: %s", method, path, type(exc).__name__)
        raise HTTPException(status_code=504, detail="SHM upstream timeout")
    except httpx.RequestError as exc:
        logging.warning("SHM %s %s upstream_error: %s", method, path, type(exc).__name__)
        raise HTTPException(status_code=502, detail="SHM upstream unreachable")
    finally:
        _shm_inflight_dec()
    if resp.status_code in (200, 201):
        if resp.content:
            try:
                return resp.json()
            except Exception:
                return {}
        return {}
    if resp.status_code == 404:
        return {}
    logging.warning("SHM %s %s -> %s: %s", method, path, resp.status_code, resp.text[:500])
    raise HTTPException(status_code=resp.status_code, detail=resp.text)
