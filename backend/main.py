"""SHM Cabinet — FastAPI backend (proxy).

Тонкий entrypoint: создаёт FastAPI-приложение, подключает наблюдаемость
(structlog/Sentry), middleware (request_id, security headers), CORS,
роутеры и (в проде) отдаёт статику SPA.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from cache import cache
from config import settings
from db import db_enabled, init_engine, run_migrations, shutdown_engine
from kuma_status import close_kuma_client
from logging_config import configure_logging, get_logger
from metrics import PrometheusMiddleware
from middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from rate_limit import limiter
from remnawave_client import close_remna_client
from routers import devices, public, shm_proxy, status, system, vpn
from routers import cart as cart_router
from routers import notifications as notifications_router
from scheduler import shutdown_scheduler, start_scheduler
from shm_client import close_shm_client


# Настраиваем logging до всех прочих импортов бизнес-логики, чтобы
# библиотечные logging.X вызовы тоже попали в structlog-pipeline.
configure_logging(level=settings.LOG_LEVEL, json_output=settings.LOG_JSON)
log = get_logger("app")


# Sentry: инициализация только если задан DSN, чтобы не создавать лишних
# зависимостей в локальной разработке/CI.
if settings.SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.SENTRY_ENVIRONMENT,
            traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
            integrations=[StarletteIntegration(), FastApiIntegration()],
            send_default_pii=False,
        )
        log.info("sentry.enabled", environment=settings.SENTRY_ENVIRONMENT)
    except Exception as exc:
        log.warning("sentry.init_failed", error=str(exc))


# --- Heartbeat -------------------------------------------------------------
# Раз в _HEARTBEAT_INTERVAL_S фоновая корутина пишет `app.heartbeat`. Если
# event loop встанет (sync-блокировка, deadlock, забитый пул), heartbeat
# перестанет появляться в логах ровно с момента залипа — это даёт нам
# точную точку отсчёта вместо «работало и вдруг тишина».
_HEARTBEAT_INTERVAL_S = 30.0
_heartbeat_task: Optional[asyncio.Task] = None


async def _heartbeat_loop() -> None:
    hb_log = get_logger("app")
    while True:
        try:
            await asyncio.sleep(_HEARTBEAT_INTERVAL_S)
        except asyncio.CancelledError:
            break
        try:
            tasks = asyncio.all_tasks()
            running = sum(1 for t in tasks if not t.done())
            hb_log.info("app.heartbeat", running_tasks=running)
        except Exception as exc:  # pragma: no cover — диагностический лог не должен валить процесс
            hb_log.warning("app.heartbeat_failed", error=str(exc))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    cache.configure()
    if db_enabled():
        try:
            await run_migrations()
            init_engine()
        except Exception as exc:
            if settings.DB_REQUIRED:
                log.error("lifespan.db_init_failed", error=str(exc))
                raise
            log.warning(
                "lifespan.db_init_failed_fail_open",
                error=str(exc),
                hint="DB_REQUIRED=False: backend starts anyway; "
                     "DB-backed endpoints (cart/notifications) will return 503.",
            )
    start_scheduler()
    global _heartbeat_task
    _heartbeat_task = asyncio.create_task(_heartbeat_loop())
    # Явный сигнал «lifespan-startup закончился» с версией. BUILD_SHA имеет
    # смысл пробрасывать из CI/Dockerfile; пока его нет — будет "unknown",
    # но сам факт записи покажет, что новый код доехал до прода.
    log.info(
        "app.ready",
        build_sha=os.environ.get("BUILD_SHA", "unknown"),
        heartbeat_interval_s=_HEARTBEAT_INTERVAL_S,
    )
    yield
    # Shutdown
    if _heartbeat_task is not None:
        _heartbeat_task.cancel()
        try:
            await _heartbeat_task
        except asyncio.CancelledError:
            pass
        _heartbeat_task = None
    shutdown_scheduler()
    await shutdown_engine()
    # Закрываем singleton-httpx-клиенты, чтобы корректно отпустить keep-alive
    # соединения и не оставлять «висячие» сокеты при graceful-перезапуске.
    await close_shm_client()
    await close_remna_client()
    await close_kuma_client()


app = FastAPI(title="SHM Cabinet API", version="1.0.0", lifespan=lifespan)

# slowapi
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Порядок middleware: последним добавленный — самый внешний. GZip должен быть
# наружнее остальных, чтобы сжимать финальный body после прохождения
# security/metrics/request-context.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(PrometheusMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Самый внешний: разворачивает X-Forwarded-For/Proto и подменяет scope["client"]
# реальным IP клиента ДО того, как до него доберутся access-логгер,
# slowapi-лимитер и роутеры. Без этого в docker все запросы выглядят как один
# IP (frontend-контейнер nginx), и RPS-лимиты бьют всех чохом.
# trusted_hosts="*": бэкенд биндится только на loopback в docker-compose,
# единственный источник запросов — nginx по docker-сети, чьи IP динамические.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.include_router(public.router)
app.include_router(devices.router)
app.include_router(vpn.router)
app.include_router(status.router)
app.include_router(system.router)
app.include_router(cart_router.router)
app.include_router(notifications_router.router)
app.include_router(shm_proxy.router)


# ---------------------------------------------------------------------------
# Serve static frontend (production)
# ---------------------------------------------------------------------------

if os.path.exists("../frontend/dist"):
    app.mount("/assets", StaticFiles(directory="../frontend/dist/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        return FileResponse("../frontend/dist/index.html")
