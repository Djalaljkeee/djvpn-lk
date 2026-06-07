"""Retry-обёртка для исходящих HTTP-запросов через connect-нестабильную сеть.

После переезда ЛК на новый сервер исходящие запросы к SHM/Remnawave идут на
публичные домены (admin.djvpn.ru, remna.djvpn.ru), которые обслуживает Caddy
на ТОМ ЖЕ хосте — это hairpin NAT. Под бёрстом (страница ЛК открывает 10-15
запросов разом) часть TCP-handshake'ов до Caddy не доезжает и httpx падает в
ConnectTimeout/ConnectError/PoolTimeout ровно через connect-таймаут. Одиночные
запросы при этом проходят, и путь «сам» восстанавливается за доли секунды.

Ключевое наблюдение: ConnectTimeout / ConnectError / PoolTimeout означают, что
запрос НЕ дошёл до сервера (TCP-сессия не установлена). Значит повтор безопасен
для ЛЮБОГО HTTP-метода — никакого побочного эффекта на стороне сервера не
произошло. Поэтому ретраим ТОЛЬКО connect-уровень и не трогаем ReadTimeout/
WriteError (там запрос мог быть уже отправлен и частично обработан).

Джиттер в бэкоффе обязателен: без него все ~15 параллельных запросов падают
одновременно, ждут одинаковую паузу и ретраятся синхронным залпом — тем же
бёрстом, что и положил соединения. Джиттер размазывает повторы во времени,
чтобы conntrack/hairpin успевал переварить их по одному.

Это слой устойчивости, а НЕ замена сетевому фиксу на хосте (iptables SNAT /
nf_conntrack tuning — см. tasks/lessons.md «Hairpin NAT»). Корневую причину
лечит хост; ретрай лишь absorbs первый «холодный» бёрст, пока conntrack/hairpin
раскачивается.
"""

from __future__ import annotations

import asyncio
import logging
import random

import httpx

# Только connect-уровень: запрос гарантированно не достиг сервера → повтор
# идемпотентен для любого метода. ReadTimeout сюда НЕ входит намеренно.
_RETRY_EXC = (httpx.ConnectTimeout, httpx.ConnectError, httpx.PoolTimeout)

# 1 повтор (2 попытки всего). Бюджет latency ограничен: connect-таймаут 5с,
# фронт обрывает запрос на 15с (axios timeout). 2 попытки = worst-case ~10.5с,
# укладывается под фронтовый таймаут и при этом ловит транзиентный «холодный»
# бёрст, который и есть наблюдаемый режим отказа.
_MAX_RETRIES = 1
# База бэкоффа; реальная пауза = uniform(base, 2*base) — джиттер для де-синка.
_BACKOFF_BASE_S = 0.25


async def request_with_connect_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    label: str,
    **kwargs,
) -> httpx.Response:
    """`client.request` с повтором на connect-уровневых сбоях.

    На исчерпании попыток пробрасывает последнее исключение — вызывающий код
    маппит его в 502/504 ровно как и раньше. `label` идёт в лог вместо полного
    URL (в нём бывает session/uuid), чтобы не шуметь секретами.
    """
    last_exc: BaseException | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return await client.request(method, url, **kwargs)
        except _RETRY_EXC as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES:
                delay = random.uniform(_BACKOFF_BASE_S, 2 * _BACKOFF_BASE_S)
                logging.warning(
                    "http_retry %s %s attempt=%d/%d: %s; retry in %.2fs",
                    method, label, attempt + 1, _MAX_RETRIES + 1,
                    type(exc).__name__, delay,
                )
                await asyncio.sleep(delay)
            else:
                logging.warning(
                    "http_retry %s %s attempt=%d/%d: %s; giving up",
                    method, label, attempt + 1, _MAX_RETRIES + 1,
                    type(exc).__name__,
                )
    # _RETRY_EXC всегда выставляет last_exc до выхода из цикла.
    assert last_exc is not None
    raise last_exc
