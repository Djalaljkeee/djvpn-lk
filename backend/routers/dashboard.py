"""Aggregated dashboard endpoint.

Single `GET /api/dashboard` возвращает весь payload личного кабинета одним
запросом. Все апстримы вызываются параллельно через `asyncio.gather(...,
return_exceptions=True)`, ответ целиком кешируется в Redis по ключу
`dashboard:{user_id}` на `DASHBOARD_CACHE_TTL` секунд. Падение одного блока
не роняет весь ответ — он возвращает `null` и попадает в поле `errors`.
Частичные ответы (с errors) не кладутся в кеш.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select

from cache import cache
from config import settings
from db import db_enabled, get_db_session
from db.models import NotificationInbox
from kuma_status import get_server_status_data
from logging_config import get_logger
from models import DashboardResponse
from normalizers import normalize_payment, normalize_user_service
from remnawave_client import remnawave_request, resolve_remna_uuid
from security import get_current_session
from shm_client import shm_request
from storage import fetch_sub_url_from_storage


router = APIRouter()
log = get_logger("dashboard")


# ---------------------------------------------------------------------------
# Per-block fetchers (все возвращают JSON-сериализуемые dict/list)
# ---------------------------------------------------------------------------


async def _fetch_profile(session: dict) -> dict:
    data = await shm_request("GET", "/shm/v1/user", session["shm_session"])
    return (data.get("data") or [{}])[0]


async def _fetch_user_services_raw(session: dict) -> list[dict]:
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    return data.get("data", []) or []


async def _build_services(raw_list: list[dict], session: dict) -> list[dict]:
    services = [normalize_user_service(s) for s in raw_list]
    missing_idx = [
        i for i, s in enumerate(services)
        if not s.get("subscription_url") and s.get("id")
    ]
    if missing_idx:
        try:
            urls = await asyncio.gather(
                *[
                    fetch_sub_url_from_storage(services[i]["id"], session.get("user_id", 0))
                    for i in missing_idx
                ],
                return_exceptions=True,
            )
            for i, url in zip(missing_idx, urls):
                if isinstance(url, str) and url:
                    services[i]["subscription_url"] = url
        except Exception:
            pass
    return services


async def _build_devices(raw_list: list[dict], session: dict) -> list[dict]:
    user_id = session.get("user_id", 0)
    valid_services = [s for s in raw_list if s.get("user_service_id")]

    async def fetch_one(svc: dict) -> dict:
        user_service_id = svc["user_service_id"]
        service_info = svc.get("service") or {}
        service_name = service_info.get("name") or svc.get("name", "")
        service_id = svc.get("service_id", 0)
        devices: list[dict] = []
        try:
            uuid = await resolve_remna_uuid(user_service_id, svc, user_id)
            if uuid:
                remna_data = await remnawave_request("GET", f"/api/hwid/devices/{uuid}")
                raw = (remna_data.get("response") or {}).get("devices") or []
                devices = [d for d in raw if isinstance(d, dict)]
        except Exception as exc:
            log.warning("dashboard.devices_fetch_failed",
                        user_service_id=user_service_id, error=str(exc)[:200])
        return {
            "service_id": service_id,
            "service_name": service_name,
            "user_service_id": user_service_id,
            "devices": devices,
        }

    return list(await asyncio.gather(*[fetch_one(s) for s in valid_services]))


async def _build_remna_info(raw_list: list[dict], session: dict) -> list[dict]:
    user_id = session.get("user_id", 0)
    valid_services = [s for s in raw_list if s.get("user_service_id")]

    async def fetch_one(svc: dict) -> dict:
        user_service_id = svc["user_service_id"]
        out: dict[str, Any] = {
            "user_service_id": user_service_id,
            "used_traffic_bytes": None,
            "traffic_limit_bytes": None,
            "limit_ip": None,
            "hwid_device_limit": None,
            "online_at": None,
            "locations": [],
        }
        try:
            uuid = await resolve_remna_uuid(user_service_id, svc, user_id)
            if not uuid:
                return out
            resp = await remnawave_request("GET", f"/api/users/{uuid}")
            user_data = resp.get("response") or resp
            inbounds = user_data.get("activeUserInbounds") or user_data.get("inbounds") or []
            tags: list[str] = []
            for inb in inbounds:
                tag = inb.get("tag") or inb.get("inboundTag") or inb.get("name")
                if tag:
                    tags.append(tag)
            traffic = user_data.get("userTraffic") or {}
            out.update({
                "used_traffic_bytes": traffic.get("usedTrafficBytes") or user_data.get("usedTrafficBytes"),
                "traffic_limit_bytes": user_data.get("trafficLimitBytes"),
                "limit_ip": user_data.get("limitIp"),
                "hwid_device_limit": user_data.get("hwidDeviceLimit"),
                "online_at": traffic.get("onlineAt") or user_data.get("onlineAt"),
                "locations": tags,
            })
        except Exception as exc:
            log.warning("dashboard.remna_info_fetch_failed",
                        user_service_id=user_service_id, error=str(exc)[:200])
        return out

    return list(await asyncio.gather(*[fetch_one(s) for s in valid_services]))


async def _fetch_payments(session: dict) -> list[dict]:
    data = await shm_request("GET", "/shm/v1/user/pay", session["shm_session"])
    return [normalize_payment(p) for p in data.get("data", [])]


async def _fetch_service_orders(session: dict) -> list[dict]:
    """Каталог услуг, доступных пользователю к заказу (/shm/v1/service/order).

    Не путать с историей платежей — это используется фронтом для проверки,
    доступен ли пробный период (orders.some(o => o.service_id === TRIAL)).
    """
    data = await shm_request(
        "GET", "/shm/v1/service/order", session["shm_session"],
        params={"limit": 100, "offset": 0},
    )
    return data.get("data", []) or []


async def _fetch_paysystems(session: dict) -> list[dict]:
    data = await shm_request("GET", "/shm/v1/user/pay/paysystems", session["shm_session"])
    return data.get("data", []) or []


async def _fetch_forecast(session: dict) -> dict:
    return await shm_request(
        "GET", "/shm/v1/user/pay/forecast", session["shm_session"],
        params={"limit": 25, "offset": 0},
    )


async def _fetch_notifications(session: dict, limit: int = 20) -> dict:
    if not db_enabled():
        return {"items": [], "unread": 0}
    user_id = session.get("user_id", 0)
    if not user_id:
        return {"items": [], "unread": 0}
    limit = max(1, min(int(limit), 100))
    async for db in get_db_session():
        rows = (
            await db.execute(
                select(NotificationInbox)
                .where(NotificationInbox.user_id == user_id)
                .order_by(desc(NotificationInbox.created_at))
                .limit(limit)
            )
        ).scalars().all()
        unread = (
            await db.execute(
                select(func.count())
                .select_from(NotificationInbox)
                .where(
                    NotificationInbox.user_id == user_id,
                    NotificationInbox.read_at.is_(None),
                )
            )
        ).scalar_one()
        items = [
            {
                "id": r.id,
                "type": r.type,
                "payload": r.payload,
                "read_at": r.read_at.isoformat() if r.read_at else None,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
        return {"items": items, "unread": int(unread)}
    return {"items": [], "unread": 0}


async def _fetch_status() -> dict:
    return await get_server_status_data()


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def _timed(
    name: str,
    factory: Callable[[], Awaitable[Any]],
) -> tuple[str, Any, float, Optional[str]]:
    """Запускает блок, возвращает (name, value, elapsed_ms, error_or_None)."""
    start = time.perf_counter()
    try:
        value = await factory()
        return name, value, (time.perf_counter() - start) * 1000, None
    except Exception as exc:
        elapsed = (time.perf_counter() - start) * 1000
        log.warning("dashboard.block_failed", block=name, error=str(exc)[:200])
        return name, None, elapsed, (str(exc)[:200] or type(exc).__name__)


async def _collect(session: dict) -> tuple[dict, dict, dict]:
    """Собрать все блоки. Возвращает (payload, timings, errors)."""
    # `/shm/v1/user/service` нужен сразу трём блокам (services/devices/remna_info).
    # Запускаем один раз, остальные блоки ждут этот общий Task.
    raw_services_task = asyncio.create_task(_fetch_user_services_raw(session))

    async def services_block():
        raw = await raw_services_task
        return await _build_services(raw, session)

    async def devices_block():
        raw = await raw_services_task
        return await _build_devices(raw, session)

    async def remna_info_block():
        raw = await raw_services_task
        return await _build_remna_info(raw, session)

    results = await asyncio.gather(
        _timed("profile", lambda: _fetch_profile(session)),
        _timed("services", services_block),
        _timed("devices", devices_block),
        _timed("remna_info", remna_info_block),
        _timed("payments", lambda: _fetch_payments(session)),
        _timed("orders", lambda: _fetch_service_orders(session)),
        _timed("paysystems", lambda: _fetch_paysystems(session)),
        _timed("forecast", lambda: _fetch_forecast(session)),
        _timed("notifications", lambda: _fetch_notifications(session)),
        _timed("status", _fetch_status),
    )

    blocks = {name: value for name, value, _, _ in results}
    timings = {f"{name}_ms": round(elapsed, 1) for name, _, elapsed, _ in results}
    errors = {name: err for name, _, _, err in results if err}

    profile = blocks.get("profile") or {}
    balance = None
    if profile:
        try:
            balance = {"amount": float(profile.get("balance") or 0), "currency": "RUB"}
        except (TypeError, ValueError):
            balance = None

    payload = {
        "profile": profile or None,
        "balance": balance,
        "services": blocks.get("services"),
        "devices": blocks.get("devices"),
        "remna_info": blocks.get("remna_info"),
        # `orders` — каталог услуг, доступных пользователю к заказу
        # (соответствует /api/user/service/orders, не payments).
        "orders": blocks.get("orders"),
        "payments": blocks.get("payments"),
        "paysystems": blocks.get("paysystems"),
        "forecast": blocks.get("forecast"),
        "notifications": blocks.get("notifications"),
        "status": blocks.get("status"),
        "maintenance": {
            "enabled": bool(settings.MAINTENANCE_MODE),
            "message": settings.MAINTENANCE_MESSAGE or "",
        },
        "errors": errors,
    }
    return payload, timings, errors


@router.get("/api/dashboard", response_model=DashboardResponse)
async def get_dashboard(session: dict = Depends(get_current_session)):
    user_id = session.get("user_id", 0)
    cache_key = f"dashboard:{user_id}" if user_id else None
    start = time.perf_counter()

    if cache_key:
        try:
            cached = await cache.get(cache_key)
        except Exception as exc:  # pragma: no cover — cache backend упал
            cached = None
            log.warning("dashboard.cache_get_failed", error=str(exc))
        if cached is not None:
            log.info(
                "dashboard.hit",
                user_id=user_id,
                total_ms=round((time.perf_counter() - start) * 1000, 1),
            )
            return cached

    payload, timings, errors = await _collect(session)
    total_ms = round((time.perf_counter() - start) * 1000, 1)
    log.info(
        "dashboard.miss",
        user_id=user_id,
        total_ms=total_ms,
        errors=list(errors.keys()) or None,
        **timings,
    )

    # Частичные ответы не кешируем: transient upstream blip не должен
    # залипнуть в кеше на TTL секунд.
    if cache_key and not errors:
        try:
            await cache.set(cache_key, payload, ttl=settings.DASHBOARD_CACHE_TTL)
        except Exception as exc:  # pragma: no cover
            log.warning("dashboard.cache_set_failed", error=str(exc))

    return payload
