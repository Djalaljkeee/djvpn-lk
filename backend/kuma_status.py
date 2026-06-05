"""Uptime Kuma status page proxy with a tiny in-process cache."""

import asyncio
import logging
import time
from typing import Optional

import httpx
from fastapi import HTTPException

from config import settings


_kuma_cache: dict = {"data": None, "ts": 0}
_KUMA_CACHE_TTL = 30  # секунд

_KUMA_LIMITS = httpx.Limits(
    max_connections=10,
    max_keepalive_connections=5,
    keepalive_expiry=30.0,
)
_KUMA_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
_kuma_client: Optional[httpx.AsyncClient] = None


def get_kuma_client() -> httpx.AsyncClient:
    global _kuma_client
    if _kuma_client is None:
        _kuma_client = httpx.AsyncClient(timeout=_KUMA_TIMEOUT, limits=_KUMA_LIMITS)
    return _kuma_client


async def close_kuma_client() -> None:
    global _kuma_client
    if _kuma_client is not None:
        await _kuma_client.aclose()
        _kuma_client = None


def _parse_kuma_url(url: str):
    """Parse 'https://kuma.example.com/status/slug' → (base, slug)."""
    url = url.rstrip("/")
    parts = url.split("/status/")
    if len(parts) != 2:
        return None, None
    return parts[0], parts[1]


async def get_server_status_data() -> dict:
    if not settings.KUMA_STATUS_URL:
        raise HTTPException(status_code=404, detail="Status page not configured")

    now = time.time()
    if _kuma_cache["data"] and now - _kuma_cache["ts"] < _KUMA_CACHE_TTL:
        return _kuma_cache["data"]

    base, slug = _parse_kuma_url(settings.KUMA_STATUS_URL)
    if not base or not slug:
        raise HTTPException(status_code=500, detail="Invalid KUMA_STATUS_URL format")

    client = get_kuma_client()
    try:
        # return_exceptions=True: один зависший вызов не должен парализовать
        # второй; обрабатываем результат вручную ниже.
        results = await asyncio.gather(
            client.get(f"{base}/api/status-page/{slug}"),
            client.get(f"{base}/api/status-page/heartbeat/{slug}"),
            return_exceptions=True,
        )
        page_resp, hb_resp = results
        for r in (page_resp, hb_resp):
            if isinstance(r, BaseException):
                raise r
        page_resp.raise_for_status()
        hb_resp.raise_for_status()
    except Exception as e:
        logging.error("Kuma fetch error: %s", e)
        if _kuma_cache["data"]:
            return _kuma_cache["data"]
        raise HTTPException(status_code=502, detail="Cannot reach status page")

    page_data = page_resp.json()
    hb_data = hb_resp.json()

    heartbeat_list = hb_data.get("heartbeatList", {})
    uptime_list = hb_data.get("uptimeList", {})

    groups = []
    for group in page_data.get("publicGroupList", []):
        monitors = []
        for mon in group.get("monitorList", []):
            mid = str(mon.get("id", ""))
            beats = heartbeat_list.get(mid, [])
            last_beat = beats[-1] if beats else {}
            uptime_24 = uptime_list.get(f"{mid}_24", None)
            uptime_720 = uptime_list.get(f"{mid}_720", None)
            monitors.append({
                "id": mon.get("id"),
                "name": mon.get("name", ""),
                "status": last_beat.get("status", 0),
                "ping": last_beat.get("ping", 0),
                "uptime_24": round(uptime_24 * 100, 1) if uptime_24 is not None else None,
                "uptime_720": round(uptime_720 * 100, 1) if uptime_720 is not None else None,
            })
        groups.append({
            "id": group.get("id"),
            "name": group.get("name", ""),
            "monitors": monitors,
        })

    result = {"groups": groups, "status_url": settings.KUMA_STATUS_URL}
    _kuma_cache["data"] = result
    _kuma_cache["ts"] = now
    return result
