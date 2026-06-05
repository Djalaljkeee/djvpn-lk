"""Remnawave API client and UUID resolution."""

import json
import logging
from typing import Optional

import httpx
from fastapi import HTTPException

from config import settings


# См. shm_client._SHM_LIMITS — те же соображения. Remna допускает self-signed
# сертификат (verify=False), поэтому ему нужен отдельный клиент.
_REMNA_LIMITS = httpx.Limits(
    max_connections=50,
    max_keepalive_connections=20,
    keepalive_expiry=30.0,
)
_REMNA_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0)

_remna_client: Optional[httpx.AsyncClient] = None


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
    resp = await client.request(method, url, headers=headers, json=json_data, params=params)
    if resp.status_code in (200, 201):
        return resp.json() if resp.content else {}
    if resp.status_code == 404:
        return {}
    logging.warning("Remnawave %s %s -> %s: %s", method, path, resp.status_code, resp.text[:500])
    raise HTTPException(status_code=resp.status_code, detail=resp.text)


async def resolve_remna_uuid(
    user_service_id: int,
    svc: dict | None = None,
    user_id: int = 0,
    session_id: str = "",
) -> Optional[str]:
    """Resolve Remnawave UUID for a user service.

    Lookup chain:
    1. svc.data.uuid (inline in SHM user/service response)
    2. SHM storage vpn_mrzb_{user_service_id}.uuid (нужна пользовательская
       SHM session — без неё storage отвечает 401/403 и UUID не найти)
    3. Remnawave /api/users/by-username/us_{shm_user_id}  (fallback — user-wide)
    """
    # Локальный импорт, чтобы избежать циклического импорта с storage.py
    from storage import fetch_storage_data

    logging.debug("_resolve_remna_uuid: usi=%s user_id=%s has_svc=%s", user_service_id, user_id, bool(svc))
    if svc:
        raw_data = svc.get("data") or {}
        if isinstance(raw_data, str):
            try:
                raw_data = json.loads(raw_data)
            except Exception:
                raw_data = {}
        uuid_val = raw_data.get("uuid")
        logging.debug("_resolve_remna_uuid: step1 svc.data keys=%s uuid=%s", list(raw_data.keys()) if isinstance(raw_data, dict) else None, uuid_val)
        if uuid_val:
            return uuid_val

    storage = await fetch_storage_data(user_service_id, session_id, user_id)
    logging.debug("_resolve_remna_uuid: step2 storage keys=%s uuid=%s", list(storage.keys()) if storage else None, storage.get("uuid") if storage else None)
    uuid_val = storage.get("uuid")
    if uuid_val:
        return uuid_val

    # Fallback: lookup by username convention us_<shm_user_id>
    if user_id and settings.REMNA_BASE_URL and settings.REMNA_TOKEN:
        try:
            resp = await remnawave_request("GET", f"/api/users/by-username/us_{user_id}")
            payload = resp.get("response") or resp
            if isinstance(payload, list):
                payload = payload[0] if payload else {}
            uuid_val = (payload or {}).get("uuid")
            logging.debug("_resolve_remna_uuid: step3 by-username us_%s uuid=%s", user_id, uuid_val)
            if uuid_val:
                return uuid_val
        except Exception as e:
            logging.warning("_resolve_remna_uuid step3 by-username us_%s: %s", user_id, e)
    else:
        logging.debug("_resolve_remna_uuid: step3 skipped (user_id=%s, remna_configured=%s)", user_id, bool(settings.REMNA_BASE_URL and settings.REMNA_TOKEN))

    return None
