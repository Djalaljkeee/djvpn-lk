"""structlog configuration.

Выводит JSON (прод) или человекочитаемый текст (dev). Одновременно
настраивает stdlib logging так, чтобы существующие `logging.X(...)` вызовы
автоматически попадали в тот же pipeline — migration-friendly.
"""

from __future__ import annotations

import logging
import sys
from contextvars import ContextVar
from typing import Any

import structlog


# ContextVar для request_id — заполняется middleware на входе запроса.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
user_id_ctx: ContextVar[int] = ContextVar("user_id", default=0)


def _add_request_context(
    logger: Any, method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """Прокидываем request_id / user_id из ContextVars в каждую запись."""
    rid = request_id_ctx.get()
    if rid and rid != "-":
        event_dict.setdefault("request_id", rid)
    uid = user_id_ctx.get()
    if uid:
        event_dict.setdefault("user_id", uid)
    return event_dict


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    """Настраивает structlog + stdlib logging.

    - JSON-вывод в stdout в проде; ConsoleRenderer в dev.
    - stdlib `logging` проксируется через structlog-формат, чтобы старые
      `logging.warning(...)` вызовы тоже оказались в JSON.
    """
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.stdlib.add_logger_name,
        timestamper,
        _add_request_context,
    ]

    if json_output:
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    # structlog-логгеры (прямой API) используют этот pipeline
    structlog.configure(
        processors=shared_processors + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(level.upper())
        ),
        cache_logger_on_first_use=True,
    )

    # Stdlib logging → тот же renderer (мост для existing logging.X вызовов)
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processor=renderer,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Снижаем шум от здоровья/keepalive uvicorn и httpx-клиента
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name) if name else structlog.get_logger()
