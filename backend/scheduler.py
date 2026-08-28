"""APScheduler: фоновые задачи внутри FastAPI-процесса.

Сейчас подключены:
  - cleanup_notifications: раз в сутки удаляет записи inbox старше N дней
  - cleanup_cart_state: раз в час удаляет протухшие корзины
  - prewarm_status: каждые 10 минут дёргает Kuma для прогрева in-memory кеша
  - support_outbox: дожимает сообщения чата, которые не ушли в бот с первого раза
  - support_fanout: дублирует ответ поддержки в Telegram, если клиент ушёл из ЛК
  - cleanup_support_messages: раз в сутки чистит старую переписку

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


async def _support_outbox() -> None:
    """Дожимает сообщения клиента, не доехавшие до бота с первой попытки.

    Тред обрабатывается строго по возрастанию id и до первой ошибки: иначе
    сообщения приедут в тему переставленными.
    """
    if not db_enabled() or not settings.SUPPORT_CHAT_ENABLED:
        return
    from sqlalchemy import select
    from db.session import _session_factory  # noqa: WPS437
    from db.models import SupportMessage, SupportThread
    from routers.support import deliver_to_bot

    if _session_factory is None:
        return
    now = datetime.now(timezone.utc)
    async with _session_factory() as session:
        rows = (
            await session.execute(
                select(SupportMessage)
                .where(
                    SupportMessage.delivery == "queued",
                    SupportMessage.direction == "in",
                    (SupportMessage.next_attempt_at.is_(None))
                    | (SupportMessage.next_attempt_at <= now),
                )
                .order_by(SupportMessage.id)
                .limit(50)
            )
        ).scalars().all()

        stuck: set[int] = set()
        sent = 0
        for message in rows:
            if message.user_id in stuck:
                continue
            if (message.attempts or 0) >= 8:
                message.delivery = "failed"
                continue
            thread = (
                await session.execute(
                    select(SupportThread).where(SupportThread.user_id == message.user_id)
                )
            ).scalar_one_or_none()
            if thread is None:
                message.delivery = "failed"
                continue
            await deliver_to_bot(session, thread, message)
            if message.delivery == "sent":
                sent += 1
            else:
                stuck.add(message.user_id)
        await session.commit()
    if rows:
        log.info("scheduler.support_outbox", picked=len(rows), sent=sent)


async def _support_fanout() -> None:
    """Дублирует ответ поддержки в Telegram, если клиент не забрал его в ЛК.

    Шлём ботом кабинета (@DJ_VPN_bot): бот поддержки не может написать первым
    тому, кто не нажимал /start именно у него, а клиент, пришедший из кабинета,
    этого не делал. Поэтому в сообщении обязателен дисклеймер — отвечать в этом
    боте бесполезно, он поддержку не читает.
    """
    if not db_enabled() or not settings.SUPPORT_CHAT_ENABLED:
        return
    if not settings.SUPPORT_TG_FANOUT or not settings.TELEGRAM_BOT_TOKEN:
        return
    from sqlalchemy import select
    from db.session import _session_factory  # noqa: WPS437
    from db.models import SupportMessage, SupportThread
    import httpx

    if _session_factory is None:
        return
    now = datetime.now(timezone.utc)
    epoch = datetime.fromtimestamp(0, timezone.utc)
    async with _session_factory() as session:
        threads = (
            await session.execute(
                select(SupportThread).where(
                    SupportThread.notify_after.isnot(None),
                    SupportThread.notify_after <= now,
                    SupportThread.telegram_chat_id.isnot(None),
                )
            )
        ).scalars().all()

        notified = 0
        for thread in threads:
            last_staff = thread.last_staff_message_at or epoch
            already_read = (thread.last_seen_at or epoch) >= last_staff
            already_notified = (thread.notified_at or epoch) >= last_staff
            if already_read or already_notified:
                thread.notify_after = None
                continue

            message = (
                await session.execute(
                    select(SupportMessage)
                    .where(
                        SupportMessage.user_id == thread.user_id,
                        SupportMessage.direction == "out",
                    )
                    .order_by(SupportMessage.id.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if message is None:
                thread.notify_after = None
                continue

            text = (
                "Служба поддержки ответила на ваше обращение:\n\n"
                f"{message.body[:900]}\n\n"
                "Отвечать здесь нельзя — этот бот не читает поддержку. "
                "Ответьте в личном кабинете."
            )
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
                        json={
                            "chat_id": thread.telegram_chat_id,
                            "text": text,
                            "reply_markup": {
                                "inline_keyboard": [[{
                                    "text": "Открыть чат поддержки",
                                    "url": f"{settings.SUPPORT_LK_URL}/?support=1",
                                }]]
                            },
                        },
                    )
                if resp.status_code == 403:
                    # Клиент не начинал диалог с ботом кабинета или заблокировал его.
                    thread.telegram_chat_id = None
                elif resp.status_code >= 300:
                    log.warning("support.fanout_failed", status=resp.status_code)
                    continue
                else:
                    notified += 1
            except httpx.HTTPError as exc:
                log.warning("support.fanout_error", error=str(exc))
                continue

            thread.notified_at = now
            thread.notify_after = None
        await session.commit()
    if notified:
        log.info("scheduler.support_fanout", notified=notified)


async def _cleanup_support_messages() -> None:
    if not db_enabled() or settings.SUPPORT_RETENTION_DAYS <= 0:
        return
    from sqlalchemy import delete
    from db.session import _session_factory  # noqa: WPS437
    from db.models import SupportMessage

    if _session_factory is None:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.SUPPORT_RETENTION_DAYS)
    async with _session_factory() as session:
        result = await session.execute(
            delete(SupportMessage).where(SupportMessage.created_at < cutoff)
        )
        await session.commit()
    log.info("scheduler.support_cleanup", deleted=result.rowcount or 0)


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

    _scheduler.add_job(
        _support_outbox,
        trigger=IntervalTrigger(seconds=20),
        id="support_outbox",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _support_fanout,
        trigger=IntervalTrigger(seconds=30),
        id="support_fanout",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _cleanup_support_messages,
        trigger=CronTrigger(hour=3, minute=35),
        id="cleanup_support_messages",
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
