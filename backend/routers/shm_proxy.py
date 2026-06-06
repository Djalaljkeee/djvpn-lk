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
from shm_client import _shm_inflight_dec, _shm_inflight_inc, get_shm_client


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
    incoming_sid = request.cookies.get("session_id")
    if incoming_sid:
        cookies["session_id"] = incoming_sid

    body = await request.body()

    started = time.perf_counter()
    # Shared singleton AsyncClient (см. shm_client.get_shm_client) — без него
    # каждый прокси-запрос открывал новое TCP/TLS-соединение, что под нагрузкой
    # съедает локальные сокеты и приводит к зависанию connect() на минуты.
    client = get_shm_client()
    _shm_inflight_inc()
    try:
        upstream = await client.request(
            request.method,
            url,
            params=request.query_params,
            headers=fwd_headers,
            cookies=cookies,
            content=body or None,
            follow_redirects=False,
        )
    finally:
        _shm_inflight_dec()
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
    # Secure-флаг ставим по реальному внешнему протоколу — X-Forwarded-Proto
    # от Caddy, а не по локальному request.url.scheme (внутри docker всегда
    # http, потому что между nginx и backend нет TLS). Читаем заголовок
    # напрямую: даже если ProxyHeadersMiddleware отключён или nginx по ошибке
    # переписал scheme в http, мы всё равно поставим корректный Secure.
    fwd_proto = request.headers.get("x-forwarded-proto", request.url.scheme).lower()
    is_secure = fwd_proto == "https"
    set_cookie_headers = upstream.headers.get_list("set-cookie")
    body_session_id = _extract_body_session(path, upstream)
    log.info(
        "shm_proxy.cookies",
        path=path,
        upstream_set_cookie_count=len(set_cookie_headers),
        body_session_id_present=bool(body_session_id),
        # Хеш входящей session_id — НЕ значение, а 8 hex символов sha256.
        # Этого хватит, чтобы по логам сопоставить «какая кука пришла на /v1/user»
        # с «какую куку выставил предыдущий /webapp/auth», и поймать момент,
        # когда браузер не сохраняет нашу новую сессию.
        incoming_sid=_sid_fingerprint(incoming_sid),
        outgoing_sid=_sid_fingerprint(body_session_id),
        is_secure=is_secure,
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

    # Forensic: лог реальных Set-Cookie заголовков, которые мы отдаём клиенту.
    # Срабатывает только когда мы что-то выставили (новая сессия / любые
    # set-cookie от SHM). Значение session_id маскируем — len + первые/последние
    # 2 символа достаточно, чтобы поймать «кука обёрнута в кавычки», «в значении
    # точка с запятой / пробел», «значение пустое» и подобные баги без
    # утечки рабочего токена в логи.
    if body_session_id or set_cookie_headers:
        outgoing = [
            _mask_set_cookie(v.decode("latin-1"))
            for k, v in response.raw_headers
            if k.decode("latin-1").lower() == "set-cookie"
        ]
        log.info(
            "shm_proxy.set_cookie_raw",
            path=path,
            headers=outgoing,
        )

    return response


def _mask_set_cookie(raw: str) -> str:
    """Прячем значение session_id в Set-Cookie, оставляя метаданные."""
    import re

    def _repl(match: "re.Match[str]") -> str:
        value = match.group(2)
        head = value[:2] if len(value) > 4 else value
        tail = value[-2:] if len(value) > 4 else ""
        return f"{match.group(1)}<len={len(value)} head={head!r} tail={tail!r}>"

    return re.sub(r"(session_id=)([^;]*)", _repl, raw)


def _sid_fingerprint(sid: str | None) -> str | None:
    if not sid:
        return None
    import hashlib
    return hashlib.sha256(sid.encode("utf-8")).hexdigest()[:8]


def _extract_body_session(path: str, upstream: httpx.Response) -> str | None:
    """Достаём session_id из JSON-тела auth-ответа SHM.

    Только для известных auth-путей и 200 — не парсим тела всех ответов
    подряд, чтобы случайный `{"id": ...}` в чужом эндпоинте не уехал в cookie.

    SHM непоследователен в имени поля: `POST /user/auth` отдаёт `{"id": ...}`,
    `GET /telegram/webapp/auth` — `{"session_id": ...}`. Поэтому пробуем оба.
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
    for key in ("session_id", "id"):
        sid = data.get(key)
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
