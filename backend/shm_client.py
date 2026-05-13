"""SHM API client helpers.

После перевода фронта на прямые вызовы SHM (admin.djvpn.ru/shm/v1/)
бэкенд ходит в SHM только для двух целей:
  1. Верификация session_id, прилетевшего в cookie (см. security.py).
  2. Получение subscriptionUrl из storage для генерации VPN-конфига
     (см. storage.py) — теперь под пользовательской сессией.

Admin Basic Auth и регистрация/логин-обёртки удалены — этим занимается фронт.
"""

import logging

import httpx
from fastapi import HTTPException

from config import settings
from logging_config import client_ip_ctx


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
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.request(
            method, url, headers=headers, cookies=cookies,
            json=json_data, params=params,
        )
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
