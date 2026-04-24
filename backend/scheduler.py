"""APScheduler: фоновые задачи внутри FastAPI-процесса.

Сейчас подключены:
  - cleanup_notifications: раз в сутки удаляет записи inbox старше N дней
  - cleanup_cart_state: раз в час удаляет протухшие корзины
  - prewarm_status: каждые 10 минут дёргает Kuma для прогрева in-memory кеша

Все джобы — best-effort. Падение одной не останавливает остальные.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from config import settings
from db import db_enabled
from logging_config import get_logger


log = get_logger("scheduler")


_scheduler: Optional[AsyncIOScheduler] = None


async def _cleanup_notifications() -> None:
    if not db_enabled() or settings.NOTIFICATION_RETENTION_DAYS <= 0:
        return
    from sqlalchemy import delete
    from db.session import _session_factory  # noqa: WPS437
    from db.models import NotificationInbox

    if _session_factory is None:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.NOTIFICATION_RETENTION_DAYS)
    async with _session_factory() as session:
        stmt = delete(NotificationInbox).where(NotificationInbox.created_at < cutoff)
        result = await session.execute(stmt)
        await session.commit()
    log.info("scheduler.notifications_cleanup", deleted=result.rowcount or 0, cutoff=cutoff.isoformat())


async def _cleanup_cart_state() -> None:
    if not db_enabled() or settings.CART_RETENTION_DAYS <= 0:
        return
    from sqlalchemy import delete
    from db.session import _session_factory  # noqa: WPS437
    from db.models import CartState

    if _session_factory is None:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.CART_RETENTION_DAYS)
    async with _session_factory() as session:
        stmt = delete(CartState).where(CartState.updated_at < cutoff)
        result = await session.execute(stmt)
        await session.commit()
    log.info("scheduler.cart_cleanup", deleted=result.rowcount or 0, cutoff=cutoff.isoformat())


async def _prewarm_status() -> None:
    """Прогреваем Uptime Kuma-кеш, чтобы первый пользовательский запрос был быстрым."""
    if not settings.KUMA_STATUS_URL:
        return
    try:
        from kuma_status import get_server_status_data
        await get_server_status_data()
        log.debug("scheduler.status_prewarm_ok")
    except Exception as exc:
        log.warning("scheduler.status_prewarm_failed", error=str(exc))


def start_scheduler() -> None:
    """Запускает scheduler и регистрирует джобы."""
    global _scheduler
    if not settings.SCHEDULER_ENABLED:
        log.info("scheduler.disabled")
        return
    if _scheduler is not None:
        return

    _scheduler = AsyncIOScheduler(timezone="UTC")

    _scheduler.add_job(
        _cleanup_notifications,
        trigger=CronTrigger(hour=3, minute=15),
        id="cleanup_notifications",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _cleanup_cart_state,
        trigger=CronTrigger(minute=10),
        id="cleanup_cart_state",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _prewarm_status,
        trigger=IntervalTrigger(minutes=10),
        id="prewarm_status",
        replace_existing=True,
        max_instances=1,
    )

    _scheduler.start()
    log.info("scheduler.started", jobs=[j.id for j in _scheduler.get_jobs()])


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("scheduler.stopped")
