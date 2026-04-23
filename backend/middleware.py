"""Custom ASGI middleware: request context + security headers."""

from __future__ import annotations

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from logging_config import request_id_ctx, user_id_ctx


log = structlog.get_logger("http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Присваивает request_id каждому запросу, пишет access-лог с latency."""

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = request.headers.get("x-request-id")
        rid = incoming or uuid.uuid4().hex[:16]
        rid_token = request_id_ctx.set(rid)
        uid_token = user_id_ctx.set(0)

        # Привязываем контекст к structlog (для любых log-вызовов внутри хэндлера)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=rid)

        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["x-request-id"] = rid
            return response
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            log.info(
                "request",
                method=request.method,
                path=request.url.path,
                status=status_code,
                latency_ms=duration_ms,
                client=request.client.host if request.client else None,
            )
            request_id_ctx.reset(rid_token)
            user_id_ctx.reset(uid_token)
            structlog.contextvars.clear_contextvars()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Минимальный набор безопасных HTTP-заголовков для API-ответов."""

    # SAMEORIGIN оставлен намеренно: Telegram Mini App грузит UI через nginx
    # фронтенда, а API возвращает JSON — фреймить его некуда, но ломать нельзя.
    HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    }

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for name, value in self.HEADERS.items():
            response.headers.setdefault(name, value)
        return response
