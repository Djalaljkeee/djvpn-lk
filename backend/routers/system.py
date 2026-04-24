"""Health / readiness / metrics endpoints."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Response

from config import settings
from db import db_enabled
from metrics import render_metrics


router = APIRouter()


@router.get("/healthz", include_in_schema=False)
async def healthz():
    """Liveness: процесс жив и может отвечать."""
    return {"status": "ok"}


@router.get("/readyz", include_in_schema=False)
async def readyz(response: Response):
    """Readiness: доступны ли апстримы.

    Проверяем: SHM, Redis (если настроен), Postgres (если настроен).
    Недоступность SHM — это всегда fail (без SHM кабинет бесполезен).
    Недоступность опциональных компонентов — fail только если они включены.
    """
    components: dict[str, dict] = {}
    overall_ok = True

    # SHM
    shm_ok = False
    shm_status = 0
    try:
        async with httpx.AsyncClient(timeout=3.0, verify=False) as client:
            r = await client.get(f"{settings.SHM_BASE_URL}/shm/v1/user/captcha")
            shm_status = r.status_code
            shm_ok = r.status_code < 500
    except Exception as exc:
        components["shm"] = {"ok": False, "error": str(exc)[:200]}
    else:
        components["shm"] = {"ok": shm_ok, "status": shm_status}
    overall_ok = overall_ok and shm_ok

    # Redis (если настроен)
    if settings.REDIS_URL:
        try:
            import redis.asyncio as redis_async
            client = redis_async.from_url(settings.REDIS_URL, decode_responses=True)
            pong = await client.ping()
            await client.aclose()
            components["redis"] = {"ok": bool(pong)}
            overall_ok = overall_ok and bool(pong)
        except Exception as exc:
            components["redis"] = {"ok": False, "error": str(exc)[:200]}
            overall_ok = False

    # Postgres (если настроен)
    if db_enabled():
        try:
            from db.session import _session_factory  # noqa: WPS437
            from sqlalchemy import text
            if _session_factory is None:
                components["postgres"] = {"ok": False, "error": "engine not initialized"}
                overall_ok = False
            else:
                async with _session_factory() as session:
                    await session.execute(text("SELECT 1"))
                components["postgres"] = {"ok": True}
        except Exception as exc:
            components["postgres"] = {"ok": False, "error": str(exc)[:200]}
            overall_ok = False

    if not overall_ok:
        response.status_code = 503
    return {"ok": overall_ok, "components": components}


@router.get("/metrics", include_in_schema=False)
async def metrics():
    """Prometheus-метрики (production-экспонирование за ACL/basic-auth на уровне nginx)."""
    body, content_type = render_metrics()
    return Response(content=body, media_type=content_type)
