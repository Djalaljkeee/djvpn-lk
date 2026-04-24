"""Prometheus-метрики: histogram по latency и counter по запросам.

Подключается middleware`ом над уже существующим pipeline.
Экспортируется через роут `/metrics` (см. routers/system.py).
"""

from __future__ import annotations

import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

CACHE_HITS = Counter("cache_hits_total", "Cache hits", ["key_prefix"])
CACHE_MISSES = Counter("cache_misses_total", "Cache misses", ["key_prefix"])


def _template_path(request: Request) -> str:
    """Нормализуем путь до шаблона маршрута, чтобы не плодить метрики
    по {service_id} / {img_id} и т.п."""
    route = request.scope.get("route")
    if route is not None and getattr(route, "path", None):
        return route.path
    return request.url.path


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration = time.perf_counter() - start
            path = _template_path(request)
            REQUEST_LATENCY.labels(request.method, path).observe(duration)
            REQUEST_COUNT.labels(request.method, path, str(status_code)).inc()


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
