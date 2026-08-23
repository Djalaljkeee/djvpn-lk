"""Remnawave API client and UUID resolution."""

import json
import logging
from typing import Optional

import httpx
from fastapi import HTTPException

from config import settings
from http_retry import request_with_connect_retry


# См. shm_client._SHM_LIMITS — те же соображения. Remna допускает self-signed
# сертификат (verify=False), поэтому ему нужен отдельный клиент.
_REMNA_LIMITS = httpx.Limits(
    max_connections=50,
    max_keepalive_connections=20,
    keepalive_expiry=30.0,
)
_REMNA_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0)

_remna_client: Optional[httpx.AsyncClient] = None

_remna_in_flight: int = 0


def _remna_inflight_inc() -> None:
    global _remna_in_flight
    _remna_in_flight += 1


def _remna_inflight_dec() -> None:
    global _remna_in_flight
    _remna_in_flight -= 1


def get_remna_in_flight() -> int:
    return _remna_in_flight


def get_remna_client() -> httpx.AsyncClient:
    global _remna_client
    if _remna_client is None:
        _remna_client = httpx.AsyncClient(
            timeout=_REMNA_TIMEOUT,
            limits=_REMNA_LIMITS,
            verify=False,
        )
    return _remna_client


async def close_remna_client() -> None:
    global _remna_client
    if _remna_client is not None:
        await _remna_client.aclose()
        _remna_client = None


async def remnawave_request(
    method: str,
    path: str,
    json_data: dict = None,
    params: dict = None,
) -> dict:
    if not settings.REMNA_BASE_URL or not settings.REMNA_TOKEN:
        raise HTTPException(status_code=503, detail="Remnawave integration not configured")
    url = f"{settings.REMNA_BASE_URL}{path}"
    headers = {
        "Authorization":      f"Bearer {settings.REMNA_TOKEN}",
        "X-Api-Key":          settings.REMNA_TOKEN,
        "Content-Type":       "application/json",
        "X-Forwarded-Proto":  "https",
        "X-Forwarded-For":    "127.0.0.1",
        "X-Real-IP":          "127.0.0.1",
    }
    client = get_remna_client()
    _remna_inflight_inc()
    try:
        resp = await request_with_connect_retry(
            client, method, url, label=path,
            headers=headers, json=json_data, params=params,
        )
    except httpx.TimeoutException as exc:
        # Без обёртки httpx-таймаут долетал до вызывающего кода в
        # devices.py как пустой `ConnectTimeout()` (logging.warning %s
        # рендерит как ""), и в логах было видно `get_devices usi=N: `
        # без причины. 504 + явный type(exc).__name__ делают upstream-сбой
        # видимым в логах и для фронта.
        logging.warning("Remnawave %s %s upstream_error: %s", method, path, type(exc).__name__)
        raise HTTPException(status_code=504, detail="Remnawave upstream timeout")
    except httpx.RequestError as exc:
        logging.warning("Remnawave %s %s upstream_error: %s", method, path, type(exc).__name__)
        raise HTTPException(status_code=502, detail="Remnawave upstream unreachable")
    finally:
        _remna_inflight_dec()
    if resp.status_code in (200, 201):
        return resp.json() if resp.content else {}
    if resp.status_code == 404:
        return {}
    logging.warning("Remnawave %s %s -> %s: %s", method, path, resp.status_code, resp.text[:500])
    raise HTTPException(status_code=resp.status_code, detail=resp.text)


async def _remna_user_by_username(username: str) -> dict:
    """GET /api/users/by-username/<username> -> объект пользователя ({} если нет)."""
    resp = await remnawave_request("GET", f"/api/users/by-username/{username}")
    payload = resp.get("response") or resp
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    return payload if isinstance(payload, dict) else {}


async def _remna_user_by_filter(field: str, value: str) -> dict:
    """Найти пользователя через список с фильтром (`vlessUuid`, `shortUuid`, ...).

    В 3.x у списка `/api/users` фильтры передаются JSON-массивом
    `[{"id": <поле>, "value": <значение>}]`; поиск по строке — LIKE, поэтому
    точное совпадение проверяем сами у вызывающего кода, где это важно.
    """
    resp = await remnawave_request(
        "GET", "/api/users",
        params={"size": 1, "filters": json.dumps([{"id": field, "value": value}])},
    )
    users = ((resp.get("response") or {}).get("users")) or []
    return users[0] if isinstance(users, list) and users and isinstance(users[0], dict) else {}


def _svc_data(svc: dict | None) -> dict:
    """Распарсить `svc.data` (в SHM оно приходит либо dict, либо JSON-строкой)."""
    if not svc:
        return {}
    raw_data = svc.get("data") or {}
    if isinstance(raw_data, str):
        try:
            raw_data = json.loads(raw_data)
        except Exception:
            raw_data = {}
    return raw_data if isinstance(raw_data, dict) else {}


def _as_user_id(value) -> Optional[int]:
    """Привести значение к числовому id (SHM хранит его и строкой)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        num = int(value.strip())
        return num if num > 0 else None
    return None


async def _remna_user_by_short_uuid(short_uuid: str) -> dict:
    """GET /api/users/by-short-uuid/<shortUuid> -> объект пользователя ({} если нет)."""
    resp = await remnawave_request("GET", f"/api/users/by-short-uuid/{short_uuid}")
    payload = resp.get("response") or resp
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    return payload if isinstance(payload, dict) else {}


async def resolve_remna_user_id(
    user_service_id: int,
    svc: dict | None = None,
    user_id: int = 0,
    session_id: str = "",
    username_id: Optional[int] = None,
) -> Optional[int]:
    """Resolve Remnawave numeric user id.

    Панель 3.x убрала у пользователя колонку `uuid`: теперь он адресуется
    числовым `id` (`/api/users/{userId}`, `/api/hwid/devices/{userId}`), а
    `GET /api/users/{uuid}` отвечает 400 `expected number, received NaN`.

    Порядок повторяет идентификацию в самом SHM (плагин Remnawave 3.x):
    сначала `id` из хранилища услуги, затем `shortUuid` -> `by-short-uuid`.
    Хранилище авторитетнее имени: оно привязано к конкретной услуге, а
    `fetch_storage_data` ходит под сессией самого пользователя, так что чужой
    аккаунт оттуда не приедет.

    Lookup chain:
    1. `id` из `svc.data` / storage `vpn_mrzb_<user_service_id>`;
    2. `shortUuid` оттуда же -> `GET /api/users/by-short-uuid/{shortUuid}`;
    3. `GET /api/users/by-username/us_{shm_user_id}` — имена в панели заводятся
       по этой схеме, по одному аккаунту на пользователя SHM (`username_id`
       позволяет вызывающему коду переиспользовать один такой запрос на все
       услуги);
    4. legacy-UUID из SHM через фильтр списка по `vlessUuid` / `shortUuid` —
       на случай, если где-то сохранён именно один из них.
    """
    # Локальный импорт, чтобы избежать циклического импорта с storage.py
    from storage import fetch_storage_data

    logging.debug(
        "_resolve_remna_user_id: usi=%s user_id=%s has_svc=%s",
        user_service_id, user_id, bool(svc),
    )
    if not (settings.REMNA_BASE_URL and settings.REMNA_TOKEN):
        logging.debug("_resolve_remna_user_id: remnawave not configured")
        return None

    data = _svc_data(svc)
    if not data.get("id") and not data.get("shortUuid") and user_service_id:
        data = await fetch_storage_data(user_service_id, session_id, user_id) or {}
    logging.debug("_resolve_remna_user_id: usi=%s storage keys=%s", user_service_id, sorted(data.keys()))

    remna_id = _as_user_id(data.get("id"))
    if remna_id:
        logging.debug("_resolve_remna_user_id: step1 storage id=%s", remna_id)
        return remna_id

    short_uuid = data.get("shortUuid") or data.get("short_uuid")
    if short_uuid:
        try:
            remna_id = _as_user_id((await _remna_user_by_short_uuid(short_uuid)).get("id"))
            logging.debug("_resolve_remna_user_id: step2 by-short-uuid %s id=%s", short_uuid, remna_id)
            if remna_id:
                return remna_id
        except Exception as e:
            logging.warning("_resolve_remna_user_id step2 by-short-uuid %s: %r", short_uuid, e)

    if username_id:
        return username_id
    if user_id:
        remna_id = await resolve_remna_user_id_by_username(user_id)
        if remna_id:
            return remna_id

    uuid_val = data.get("uuid")
    if not uuid_val:
        logging.debug("_resolve_remna_user_id: usi=%s no legacy uuid to fall back on", user_service_id)
        return None

    for field in ("vlessUuid", "shortUuid"):
        try:
            user = await _remna_user_by_filter(field, uuid_val)
            if user.get(field) != uuid_val:
                continue
            remna_id = _as_user_id(user.get("id"))
            logging.debug("_resolve_remna_user_id: step4 %s=%s id=%s", field, uuid_val, remna_id)
            if remna_id:
                return remna_id
        except Exception as e:
            logging.warning("_resolve_remna_user_id step4 %s=%s: %r", field, uuid_val, e)

    return None


async def resolve_remna_user_id_by_username(user_id: int) -> Optional[int]:
    """Найти id по имени `us_<shm_user_id>` — один запрос на весь аккаунт SHM."""
    if not user_id or not (settings.REMNA_BASE_URL and settings.REMNA_TOKEN):
        return None
    try:
        remna_id = _as_user_id((await _remna_user_by_username(f"us_{user_id}")).get("id"))
        logging.debug("_resolve_remna_user_id: step3 by-username us_%s id=%s", user_id, remna_id)
        return remna_id
    except Exception as e:
        logging.warning("_resolve_remna_user_id step3 by-username us_%s: %r", user_id, e)
        return None
