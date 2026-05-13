"""Auth dependency для FastAPI: верификация SHM session_id из cookie.

Фронт ходит в SHM напрямую и получает cookie `session_id` от admin.djvpn.ru.
Тот же cookie прилетает к нам (Caddy шлёт оба домена через один корневой
домен, SameSite=None; Secure). Бэкенду остаётся вытащить cookie из запроса,
один раз сходить в SHM `/user`, узнать user_id — и закешировать на 60 секунд.
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import Cookie, Depends, HTTPException

from shm_client import shm_request


# In-process кэш верификаций: session_id -> (user_id, expires_at).
# 60 секунд достаточно: дольше — раздуваем окно после logout/блокировки.
_SESSION_CACHE: dict[str, tuple[int, float]] = {}
_SESSION_TTL = 60.0


async def _resolve_user_id(session_id: str) -> int:
    cached = _SESSION_CACHE.get(session_id)
    if cached and cached[1] > time.time():
        return cached[0]

    data = await shm_request("GET", "/shm/v1/user", session_id)
    arr = data.get("data") or []
    if not arr:
        raise HTTPException(status_code=401, detail="SHM session invalid")
    user_id = int(arr[0].get("user_id") or 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="SHM session не содержит user_id")

    _SESSION_CACHE[session_id] = (user_id, time.time() + _SESSION_TTL)
    return user_id


async def get_current_session(
    session_id: Optional[str] = Cookie(default=None),
) -> dict:
    """Проверяет SHM cookie и возвращает {shm_session, user_id}.

    Сохраняем форму прежнего JWT-payload, чтобы существующие роутеры
    (cart/notifications/devices/vpn) не пришлось переписывать.
    """
    if not session_id:
        raise HTTPException(status_code=401, detail="Нет cookie session_id")

    user_id = await _resolve_user_id(session_id)
    return {"shm_session": session_id, "user_id": user_id}
