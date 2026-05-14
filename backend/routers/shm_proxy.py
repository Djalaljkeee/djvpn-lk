"""Прозрачный backend-прокси для SHM API.

Фронт ЛК ходит /api/shm/v1/* same-origin, мы форвардим в SHM
(admin.djvpn.ru/shm/v1/*) и переписываем Set-Cookie так, чтобы cookie
session_id жила на домене ЛК, а не на admin.djvpn.ru. Это устраняет
cross-origin auth полностью: без прокси браузер блокировал бы fetch
с withCredentials (нет Allow-Credentials, cookie с чужим Domain
не приходит обратно на ЛК).
"""

from __future__ import annotations

import json
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
# Date / Server — uvicorn/Starlette добавит свои; без drop nginx ругается
# "upstream sent duplicate header line" и шумит в логах.
_DROP_RESP_HEADERS = {
    "set-cookie", "transfer-encoding", "content-encoding", "content-length",
    "connection", "keep-alive", "date", "server",
}

# Auth-эндпоинты SHM, на которых сессия выдаётся в теле как {"id": "..."},
# а не через Set-Cookie. Реальное поведение SHM (см. lessons.md): POST
# /v1/user/auth отвечает 200 без Set-Cookie, а session-token лежит в body.
# Без явной обработки cookie session_id никогда не появится на ЛК → следующий
# запрос ловит 401.
_AUTH_PATHS_WITH_BODY_SESSION = {
    "v1/user/auth",
    "v1/telegram/web/auth",
    "v1/telegram/webapp/auth",
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

    # Set-Cookie: парсим raw-заголовки от SHM напрямую (минуя cookielib —
    # его policy может молча отказать в приёме cookie из-за SameSite/Domain).
    # Path форсим в "/" — SHM может выставлять Path=/shm/..., но на ЛК
    # наш прокси живёт на /api/shm/..., и cookie с Path=/shm не будет
    # отправляться обратно.
    # domain не задаём → cookie привяжется к домену запроса (lk.djvpn.ru).
    # secure только под https, иначе локалка по http не сохранит cookie.
    is_secure = request.url.scheme == "https"
    set_cookie_headers = upstream.headers.get_list("set-cookie")
    body_session_id = _extract_body_session(path, upstream)
    log.info(
        "shm_proxy.cookies",
        path=path,
        upstream_set_cookie_count=len(set_cookie_headers),
        body_session_id_present=bool(body_session_id),
    )
    for raw in set_cookie_headers:
        name, value, max_age = _parse_cookie(raw)
        if not name:
            continue
        response.set_cookie(
            key=name,
            value=value,
            max_age=max_age,
            path="/",
            secure=is_secure,
            httponly=True,
            samesite="lax",
        )

    # SHM auth-эндпоинты отдают session в body как {"id": "..."} (не Set-Cookie).
    # Без этой ветки cookie session_id никогда не появляется на ЛК и каждый
    # следующий /v1/user возвращает 401.
    if body_session_id:
        response.set_cookie(
            key="session_id",
            value=body_session_id,
            path="/",
            secure=is_secure,
            httponly=True,
            samesite="lax",
        )

    return response


def _extract_body_session(path: str, upstream: httpx.Response) -> str | None:
    """Достаём session_id из JSON-тела auth-ответа SHM.

    Только для известных auth-путей и 200 — не парсим тела всех ответов
    подряд, чтобы случайный `{"id": ...}` в чужом эндпоинте не уехал в cookie.
    """
    if path not in _AUTH_PATHS_WITH_BODY_SESSION:
        return None
    if upstream.status_code != 200:
        return None
    try:
        data = json.loads(upstream.content)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    sid = data.get("id")
    if isinstance(sid, str) and sid:
        return sid
    return None


def _parse_cookie(raw: str) -> tuple[str | None, str, int | None]:
    """Достаём name/value/max-age из одного Set-Cookie-заголовка.

    Остальные атрибуты (Domain, Path, SameSite, Secure, HttpOnly) выкидываем —
    мы их выставляем сами.
    """
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    if not parts or "=" not in parts[0]:
        return None, "", None
    name, value = parts[0].split("=", 1)
    name = name.strip()
    value = value.strip()

    max_age: int | None = None
    for attr in parts[1:]:
        if "=" not in attr:
            continue
        k, v = attr.split("=", 1)
        if k.strip().lower() == "max-age":
            try:
                max_age = int(v.strip())
            except ValueError:
                pass
    return name, value, max_age
