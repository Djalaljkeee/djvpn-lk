"""HTTP-клиент к боту поддержки.

Мост живёт во внутренней docker-сети (`shm-cabinet`), наружу не смотрит.
Аутентификация — общий секрет в заголовке, тот же, что бот присылает нам в
вебхуке.

Клиент держится singleton'ом на весь процесс — по тем же причинам, что и в
`shm_client`: AsyncClient на каждый запрос не переиспользует keep-alive.
"""

from __future__ import annotations

import base64
from typing import Optional

import httpx

from config import settings
from logging_config import get_logger


log = get_logger("support_bridge")

_LIMITS = httpx.Limits(max_connections=10, max_keepalive_connections=5, keepalive_expiry=30.0)
_TIMEOUT = httpx.Timeout(connect=3.0, read=10.0, write=10.0, pool=3.0)
# Файл до 10 МБ + base64: и запись в сокет, и заливка в Telegram на стороне
# бота занимают куда больше, чем текстовое сообщение.
_FILE_TIMEOUT = httpx.Timeout(connect=3.0, read=60.0, write=60.0, pool=3.0)
# 400/413/422 — мост нас понял и отказал; 401 сюда не входит: секрет чинится
# правкой конфига, и накопленные сообщения после неё доедут.
_PERMANENT_STATUSES = frozenset({400, 413, 422})

_client: Optional[httpx.AsyncClient] = None


def enabled() -> bool:
    return bool(settings.SUPPORT_BRIDGE_URL and settings.SUPPORT_BRIDGE_SECRET)


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_TIMEOUT, limits=_LIMITS)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


class BridgeError(Exception):
    """Мост недоступен или отказал.

    `permanent` — повтор не поможет (клиент забанен, файл больше лимита моста):
    такое сообщение снимается с очереди сразу, а не после восьми попыток.
    """

    def __init__(self, reason: str, *, permanent: bool = False) -> None:
        super().__init__(reason)
        self.permanent = permanent


async def send_message(
    *,
    shm_user_id: int,
    telegram_id: Optional[int],
    name: Optional[str],
    text: str,
    client_msg_id: str,
) -> dict:
    """Отдаёт сообщение клиента боту.

    :returns: `{"ticket_id": int, ...}` — ticket_id запоминаем в треде.
    :raises BridgeError: мост недоступен, ответил не 2xx или вернул мусор.
    """
    if not enabled():
        raise BridgeError("bridge is not configured")

    url = settings.SUPPORT_BRIDGE_URL.rstrip("/") + "/lk/message"
    payload = {
        "shm_user_id": shm_user_id,
        "telegram_id": telegram_id,
        "name": name,
        "text": text,
        "client_msg_id": client_msg_id,
    }
    try:
        resp = await get_client().post(
            url,
            json=payload,
            headers={"x-bridge-secret": settings.SUPPORT_BRIDGE_SECRET},
        )
    except httpx.HTTPError as exc:
        raise BridgeError(f"unreachable: {type(exc).__name__}") from exc

    return _parse(resp)


async def send_file(
    *,
    shm_user_id: int,
    telegram_id: Optional[int],
    name: Optional[str],
    caption: str,
    client_msg_id: str,
    file_name: str,
    mime: str,
    data: bytes,
) -> dict:
    """Отдаёт боту файл клиента — он уходит в тему тикета, как из Telegram.

    Файл едет base64 внутри JSON: multipart сэкономил бы треть байт, но на
    пару скриншотов в день это не стоит ещё одной зависимости по обе стороны
    моста.

    :returns: `{"ticket_id": int, ...}`.
    :raises BridgeError: мост недоступен, отказал или не принял файл.
    """
    if not enabled():
        raise BridgeError("bridge is not configured")

    url = settings.SUPPORT_BRIDGE_URL.rstrip("/") + "/lk/attachment"
    payload = {
        "shm_user_id": shm_user_id,
        "telegram_id": telegram_id,
        "name": name,
        "caption": caption,
        "client_msg_id": client_msg_id,
        "file": {
            "name": file_name,
            "mime": mime,
            "size": len(data),
            "data_b64": base64.b64encode(data).decode("ascii"),
        },
    }
    try:
        resp = await get_client().post(
            url,
            json=payload,
            headers={"x-bridge-secret": settings.SUPPORT_BRIDGE_SECRET},
            timeout=_FILE_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise BridgeError(f"unreachable: {type(exc).__name__}") from exc

    return _parse(resp)


def _parse(resp: httpx.Response) -> dict:
    """Разбирает ответ моста, отделяя отказ навсегда от «попробуй позже»."""
    if resp.status_code == 403:
        # Клиент забанен в боте — молча копить его сообщения смысла нет.
        raise BridgeError("banned", permanent=True)
    if resp.status_code in _PERMANENT_STATUSES:
        # Мост разобрал запрос и отверг его: тот же байт-в-байт повтор
        # получит тот же ответ.
        raise BridgeError(f"http {resp.status_code}", permanent=True)
    if resp.status_code >= 300:
        raise BridgeError(f"http {resp.status_code}")
    try:
        return resp.json()
    except ValueError as exc:
        raise BridgeError("bad response body") from exc


async def healthy() -> bool:
    if not enabled():
        return False
    try:
        resp = await get_client().get(settings.SUPPORT_BRIDGE_URL.rstrip("/") + "/lk/health")
        return resp.status_code == 200
    except httpx.HTTPError:
        return False
