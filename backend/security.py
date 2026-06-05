"""Auth dependency для FastAPI: верификация SHM session_id из cookie.

Фронт ходит в SHM напрямую и получает cookie `session_id` от admin.djvpn.ru.
Тот же cookie прилетает к нам (Caddy шлёт оба домена через один корневой
домен, SameSite=None; Secure). Бэкенду остаётся вытащить cookie из запроса,
один раз сходить в SHM `/user`, узнать user_id — и закешировать на 60 секунд.
"""

from __future__ import annotations

import asyncio
import time
from typing import Optional

from fastapi import Cookie, Depends, HTTPException

from shm_client import shm_request


# In-process кэш верификаций: session_id -> (user_id, expires_at).
# 60 секунд достаточно: дольше — раздуваем окно после logout/блокировки.
# Жёсткий лимит размера + грубая FIFO-эвикция: Telegram WebApp генерит новый
# session_id на каждом запуске, и без потолка dict растёт неограниченно.
_SESSION_CACHE: dict[str, tuple[int, float]] = {}
_SESSION_TTL = 60.0
_SESSION_CACHE_MAX = 10_000
_SESSION_CACHE_EVICT_BATCH = 1_000

# Per-session asyncio.Lock для дедупликации параллельных SHM-вызовов.
# Telegram WebApp при старте шлёт 10+ запросов одновременно с одним и тем же
# session_id; без lock'а все они одновременно идут в SHM /v1/user (thundering
# herd), что под нагрузкой топит SHM. С lock'ом — только первый вызов идёт
# в SHM, остальные ждут результата и берут из кэша.
_SESSION_LOCKS: dict[str, asyncio.Lock] = {}


def _session_cache_put(session_id: str, user_id: int) -> None:
    if len(_SESSION_CACHE) >= _SESSION_CACHE_MAX:
        # Питоновский dict сохраняет порядок вставки: дропаем самые старые,
        # независимо от TTL — просто чтобы ограничить рост.
        for stale_key in list(_SESSION_CACHE.keys())[:_SESSION_CACHE_EVICT_BATCH]:
            _SESSION_CACHE.pop(stale_key, None)
            _SESSION_LOCKS.pop(stale_key, None)
    _SESSION_CACHE[session_id] = (user_id, time.time() + _SESSION_TTL)


def _session_lock_get(session_id: str) -> asyncio.Lock:
    # Ограничиваем словарь lock'ов тем же размером, что и кэш сессий.
    # Под пиковой нагрузкой это может выкинуть удерживаемый lock — тогда
    # новые caller'ы создадут новый Lock, и дедупликация на этой сессии
    # пропадёт. Edge case под экстремальной нагрузкой, для нашего масштаба
    # дешевле, чем сложный GC.
    if len(_SESSION_LOCKS) >= _SESSION_CACHE_MAX:
        for stale_key in list(_SESSION_LOCKS.keys())[:_SESSION_CACHE_EVICT_BATCH]:
            _SESSION_LOCKS.pop(stale_key, None)
    # setdefault атомарен в CPython, поэтому конкурирующие caller'ы получат
    # один и тот же Lock-объект.
    return _SESSION_LOCKS.setdefault(session_id, asyncio.Lock())


async def _resolve_user_id(session_id: str) -> int:
    # Fast path: cache hit без блокировки.
    cached = _SESSION_CACHE.get(session_id)
    if cached and cached[1] > time.time():
        return cached[0]

    # Slow path: берём per-session lock и идём в SHM.
    lock = _session_lock_get(session_id)
    async with lock:
        # Double-check: пока ждали lock, другой caller мог заполнить кэш.
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

        _session_cache_put(session_id, user_id)
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
