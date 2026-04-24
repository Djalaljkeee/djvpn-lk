"""SHM Cabinet — FastAPI backend (proxy).

Тонкий entrypoint: создаёт FastAPI-приложение, подключает наблюдаемость
(structlog/Sentry), middleware (request_id, security headers), CORS,
роутеры и (в проде) отдаёт статику SPA.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from cache import cache
from config import settings
from db import db_enabled, init_engine, run_migrations, shutdown_engine
from logging_config import configure_logging, get_logger
from metrics import PrometheusMiddleware
from middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from rate_limit import limiter
from routers import auth, devices, payments, public, services, status, system, user, vpn
from routers import cart as cart_router
from scheduler import shutdown_scheduler, start_scheduler


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    cache.configure()
    if db_enabled():
        await run_migrations()
        init_engine()
    start_scheduler()
    yield
    # Shutdown
    shutdown_scheduler()
    await shutdown_engine()


app = FastAPI(title="SHM Cabinet API", version="1.0.0", lifespan=lifespan)

# slowapi
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(PrometheusMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(auth.router)
app.include_router(user.router)
app.include_router(services.router)
app.include_router(devices.router)
app.include_router(payments.router)
app.include_router(vpn.router)
app.include_router(status.router)
app.include_router(system.router)
app.include_router(cart_router.router)


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
