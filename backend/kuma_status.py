"""Uptime Kuma status page proxy with a tiny in-process cache."""

import asyncio
import logging
import time

import httpx
from fastapi import HTTPException

from config import settings


_kuma_cache: dict = {"data": None, "ts": 0}
_KUMA_CACHE_TTL = 30  # секунд


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

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            page_resp, hb_resp = await asyncio.gather(
                client.get(f"{base}/api/status-page/{slug}"),
                client.get(f"{base}/api/status-page/heartbeat/{slug}"),
            )
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
