"""Прозрачный backend-прокси для SHM API.

Фронт ЛК ходит /api/shm/v1/* same-origin, мы форвардим в SHM
(admin.djvpn.ru/shm/v1/*) и переписываем Set-Cookie так, чтобы cookie
session_id жила на домене ЛК, а не на admin.djvpn.ru. Это устраняет
cross-origin auth полностью: без прокси браузер блокировал бы fetch
с withCredentials (нет Allow-Credentials, cookie с чужим Domain
не приходит обратно на ЛК).
"""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Request, Response

from config import settings
from logging_config import client_ip_ctx, get_logger


router = APIRouter()
log = get_logger("shm_proxy")


# Заголовки запроса, которые НЕ форвардим в SHM.
# Host/Origin/Referer — SHM ждёт собственные значения, не lk.djvpn.ru.
# Cookie — собираем вручную, шлём только session_id.
# Content-Length / Connection / Accept-Encoding — httpx переустанавливает сам.
_DROP_REQ_HEADERS = {
    "host", "cookie", "origin", "referer", "authorization",
    "content-length", "connection", "accept-encoding",
}

# Заголовки ответа SHM, которые НЕ пробрасываем клиенту.
# Set-Cookie обрабатываем отдельно (переписываем домен).
# Transfer-Encoding / Content-Length / Content-Encoding — Starlette выставит сам.
_DROP_RESP_HEADERS = {
    "set-cookie", "transfer-encoding", "content-encoding", "content-length",
    "connection", "keep-alive",
}


@router.api_route(
    "/api/shm/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
)
async def shm_proxy(path: str, request: Request) -> Response:
    url = f"{settings.SHM_BASE_URL}/shm/{path}"

    fwd_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _DROP_REQ_HEADERS
    }
    # X-Forwarded-For/Real-IP — реальный IP клиента из контекста middleware,
    # чтобы SHM видел юзера, а не наш backend-контейнер.
    if (ip := client_ip_ctx.get()):
        fwd_headers["X-Forwarded-For"] = ip
        fwd_headers["X-Real-IP"] = ip

    # Из cookie ЛК форвардим только session_id — это единственное, что
    # понимает SHM.
    cookies = {}
    if (sid := request.cookies.get("session_id")):
        cookies["session_id"] = sid

    body = await request.body()

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
        upstream = await client.request(
            request.method,
            url,
            params=request.query_params,
            headers=fwd_headers,
            cookies=cookies,
            content=body or None,
        )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "shm_proxy.forwarded",
        method=request.method,
        path=path,
        status=upstream.status_code,
        elapsed_ms=elapsed_ms,
    )

    resp_headers = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in _DROP_RESP_HEADERS
    }
    response = Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
    )

    # Set-Cookie: переставляем cookie на домен текущего запроса (lk.djvpn.ru
    # в проде, localhost в dev) — для этого передаём domain=None.
    # secure форсим только под https, иначе локалка по http не сохранит cookie.
    is_secure = request.url.scheme == "https"
    now = time.time()
    for cookie in upstream.cookies.jar:
        max_age = None
        if cookie.expires:
            max_age = max(0, int(cookie.expires - now))
        response.set_cookie(
            key=cookie.name,
            value=cookie.value,
            max_age=max_age,
            path=cookie.path or "/",
            secure=is_secure,
            httponly=True,
            samesite="lax",
        )

    return response
