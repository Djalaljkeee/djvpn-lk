"""Чат поддержки в кабинете.

Тикеты и темы форума живут в боте поддержки — кабинет держит только историю
переписки для клиента и мост к боту. Всё no-op, если БД выключена.

Транспорт до браузера — обычный поллинг: uvicorn запущен одним воркером с
`--limit-concurrency 200`, и сотня открытых websocket'ов съела бы этот бюджет,
после чего кабинет перестал бы отвечать всем целиком.
"""

from __future__ import annotations

import hmac
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import asc, desc, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

import support_bridge
from config import settings
from db import db_enabled, get_db_session
from db.models import NotificationInbox, SupportMessage, SupportThread
from logging_config import get_logger
from rate_limit import limiter, session_key_func
from security import get_current_session
from shm_client import shm_request


router = APIRouter()
log = get_logger("support")

MAX_TEXT = 4000
IDENTITY_TTL = timedelta(hours=24)
# Управляющие символы ломают вставку в postgres и ничего не значат в чате.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


# --------------------------------------------------------------------------- #
# Схемы
# --------------------------------------------------------------------------- #

class SupportMessageOut(BaseModel):
    id: int
    direction: str
    author: str
    body: str
    delivery: str
    created_at: str


class SupportThreadOut(BaseModel):
    enabled: bool = True
    status: str = "open"
    ticket_id: Optional[int] = None
    unread: int = 0
    last_message_at: Optional[str] = None


class SupportListOut(BaseModel):
    thread: SupportThreadOut
    items: List[SupportMessageOut] = []


class SupportSendIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    client_msg_id: str = Field(min_length=8, max_length=64)


class BotWebhookIn(BaseModel):
    ticket_id: int
    shm_user_id: int
    direction: str
    text: str
    external_id: str
    author: Optional[str] = None
    delivered_telegram: bool = False


# --------------------------------------------------------------------------- #
# Вспомогательное
# --------------------------------------------------------------------------- #

async def _db():
    async for session in get_db_session():
        yield session


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _clean(text: str) -> str:
    text = _CONTROL_RE.sub("", text.replace("\r\n", "\n")).strip()
    return re.sub(r"\n{4,}", "\n\n\n", text)[:MAX_TEXT]


def _as_out(row: SupportMessage) -> SupportMessageOut:
    return SupportMessageOut(
        id=row.id,
        direction=row.direction,
        author=row.author,
        body=row.body,
        delivery=row.delivery,
        created_at=_iso(row.created_at) or "",
    )


def _telegram_id_from(login: str, tg: dict) -> Optional[int]:
    """Telegram id клиента: сперва из settings, иначе из логина вида `@12345`."""
    chat_id = tg.get("chat_id") or tg.get("user_id")
    if chat_id:
        try:
            return int(chat_id)
        except (TypeError, ValueError):
            pass
    if login.startswith("@") and login[1:].isdigit():
        return int(login[1:])
    return None


async def _ensure_thread(db, session: dict) -> SupportThread:
    """Возвращает тред клиента, при необходимости создавая и освежая личность.

    Личность (telegram id, e-mail, имя) берётся из SHM под пользовательской
    сессией — админские креды кабинету для этого не нужны.
    """
    user_id = session["user_id"]
    thread = (
        await db.execute(select(SupportThread).where(SupportThread.user_id == user_id))
    ).scalar_one_or_none()

    fresh = thread is not None and thread.updated_at is not None and (
        datetime.now(timezone.utc) - thread.updated_at < IDENTITY_TTL
    )
    if thread is not None and fresh:
        return thread

    telegram_id: Optional[int] = None
    email: Optional[str] = None
    name: Optional[str] = None
    try:
        data = await shm_request("GET", "/shm/v1/user", session["shm_session"])
        user = (data.get("data") or [{}])[0]
        settings_blob = user.get("settings") or {}
        telegram_id = _telegram_id_from(str(user.get("login") or ""), settings_blob.get("telegram") or {})
        email = settings_blob.get("email") or None
        name = user.get("full_name") or None
    except Exception as exc:  # noqa: BLE001 - личность необязательна для чата
        log.warning("support.identity_failed", error=str(exc))

    if thread is None:
        thread = SupportThread(
            user_id=user_id,
            telegram_chat_id=telegram_id,
            email=email,
            customer_name=name,
        )
        db.add(thread)
    else:
        # Не затираем известное значение неудачным запросом в SHM.
        thread.telegram_chat_id = telegram_id or thread.telegram_chat_id
        thread.email = email or thread.email
        thread.customer_name = name or thread.customer_name
    await db.flush()
    return thread


async def _thread_out(db, thread: SupportThread) -> SupportThreadOut:
    unread = (
        await db.execute(
            select(func.count())
            .select_from(SupportMessage)
            .where(
                SupportMessage.user_id == thread.user_id,
                SupportMessage.direction == "out",
                SupportMessage.created_at > (thread.last_read_at or datetime.fromtimestamp(0, timezone.utc)),
            )
        )
    ).scalar_one()
    return SupportThreadOut(
        enabled=settings.SUPPORT_CHAT_ENABLED,
        status=thread.status,
        ticket_id=thread.ticket_id,
        unread=int(unread or 0),
        last_message_at=_iso(thread.last_message_at),
    )


async def deliver_to_bot(db, thread: SupportThread, message: SupportMessage) -> None:
    """Пробует отдать сообщение боту. Неудача — не ошибка: добьёт outbox-джоба."""
    try:
        result = await support_bridge.send_message(
            shm_user_id=thread.user_id,
            telegram_id=thread.telegram_chat_id,
            name=thread.customer_name,
            text=message.body,
            client_msg_id=message.client_msg_id or str(message.id),
        )
    except support_bridge.BridgeError as exc:
        reason = str(exc)
        message.attempts = (message.attempts or 0) + 1
        message.error = reason[:256]
        if reason == "banned":
            message.delivery = "failed"
            thread.status = "banned"
        else:
            message.delivery = "queued"
            message.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                seconds=min(20 * 2 ** message.attempts, 900)
            )
        log.warning("support.bridge_failed", user_id=thread.user_id, error=reason)
        return

    message.delivery = "sent"
    message.error = None
    ticket_id = result.get("ticket_id")
    if ticket_id:
        thread.ticket_id = int(ticket_id)


# --------------------------------------------------------------------------- #
# Клиентские ручки
# --------------------------------------------------------------------------- #

@router.get("/api/support/thread", response_model=SupportThreadOut)
async def get_thread(session: dict = Depends(get_current_session)):
    """Дешёвая ручка для бейджа: одна строка треда и число непрочитанных."""
    if not db_enabled() or not settings.SUPPORT_CHAT_ENABLED:
        return SupportThreadOut(enabled=False)
    async for db in _db():
        thread = (
            await db.execute(
                select(SupportThread).where(SupportThread.user_id == session["user_id"])
            )
        ).scalar_one_or_none()
        if thread is None:
            return SupportThreadOut(enabled=True)
        return await _thread_out(db, thread)


@router.get("/api/support/messages", response_model=SupportListOut)
async def list_messages(
    after_id: int = 0,
    limit: int = 50,
    session: dict = Depends(get_current_session),
):
    if not db_enabled() or not settings.SUPPORT_CHAT_ENABLED:
        return SupportListOut(thread=SupportThreadOut(enabled=False))

    limit = max(1, min(int(limit or 50), 200))
    user_id = session["user_id"]

    async for db in _db():
        thread = (
            await db.execute(select(SupportThread).where(SupportThread.user_id == user_id))
        ).scalar_one_or_none()
        if thread is None:
            return SupportListOut(thread=SupportThreadOut(enabled=True))

        query = select(SupportMessage).where(SupportMessage.user_id == user_id)
        if after_id:
            # Инкрементальная подгрузка: обычный ответ поллинга — пустой список.
            query = query.where(SupportMessage.id > after_id).order_by(asc(SupportMessage.id))
        else:
            query = query.order_by(desc(SupportMessage.id))
        rows = (await db.execute(query.limit(limit))).scalars().all()
        if not after_id:
            rows = list(reversed(rows))

        # Отметка «клиент на связи» — по ней решается, дублировать ли ответ в
        # Telegram. Пишем не чаще раза в 30 секунд, чтобы не гонять UPDATE на
        # каждый поллинг.
        now = datetime.now(timezone.utc)
        if thread.last_seen_at is None or (now - thread.last_seen_at).total_seconds() > 30:
            thread.last_seen_at = now

        return SupportListOut(thread=await _thread_out(db, thread), items=[_as_out(r) for r in rows])


@router.post("/api/support/messages", response_model=SupportMessageOut)
@limiter.limit("10/minute", key_func=session_key_func)
async def send_message(
    request: Request,
    payload: SupportSendIn,
    session: dict = Depends(get_current_session),
):
    if not settings.SUPPORT_CHAT_ENABLED:
        raise HTTPException(status_code=503, detail="Чат поддержки временно недоступен")
    if not db_enabled():
        raise HTTPException(status_code=503, detail="Чат недоступен: БД не настроена")

    text = _clean(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Пустое сообщение")

    user_id = session["user_id"]
    async for db in _db():
        thread = await _ensure_thread(db, session)
        if thread.status == "banned":
            raise HTTPException(status_code=403, detail="Обращения через кабинет недоступны")

        stmt = (
            pg_insert(SupportMessage)
            .values(
                user_id=user_id,
                direction="in",
                author="customer",
                body=text,
                client_msg_id=payload.client_msg_id,
                delivery="queued",
            )
            .on_conflict_do_nothing(constraint="uq_support_msg_client")
            .returning(SupportMessage)
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            # Повтор той же отправки — отдаём уже сохранённое сообщение.
            row = (
                await db.execute(
                    select(SupportMessage).where(
                        SupportMessage.user_id == user_id,
                        SupportMessage.client_msg_id == payload.client_msg_id,
                    )
                )
            ).scalar_one()
            return _as_out(row)

        thread.last_message_at = datetime.now(timezone.utc)
        await db.flush()
        await deliver_to_bot(db, thread, row)
        return _as_out(row)


@router.post("/api/support/read")
async def mark_read(session: dict = Depends(get_current_session)):
    if not db_enabled():
        raise HTTPException(status_code=503, detail="Чат недоступен: БД не настроена")
    async for db in _db():
        await db.execute(
            update(SupportThread)
            .where(SupportThread.user_id == session["user_id"])
            .values(last_read_at=datetime.now(timezone.utc))
        )
        return {"ok": True}


# --------------------------------------------------------------------------- #
# Вебхук бота
# --------------------------------------------------------------------------- #

@router.post("/api/internal/support/incoming")
@limiter.limit("120/minute")
async def bot_webhook(request: Request, payload: BotWebhookIn, response: Response):
    """Приём сообщения от бота поддержки.

    Публично достижим (nginx проксирует весь /api/), поэтому защищён общим
    секретом. Никогда не создаёт тред: не нашли — 200 и лог, иначе бот будет
    вечно ретраить сообщение, которому некуда лечь.
    """
    secret = request.headers.get("x-bridge-secret", "")
    if not settings.SUPPORT_BRIDGE_SECRET or not hmac.compare_digest(
        secret, settings.SUPPORT_BRIDGE_SECRET
    ):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not db_enabled():
        raise HTTPException(status_code=503, detail="db is off")

    body = _clean(payload.text)
    async for db in _db():
        thread = (
            await db.execute(
                select(SupportThread).where(SupportThread.user_id == payload.shm_user_id)
            )
        ).scalar_one_or_none()
        if thread is None:
            log.info("support.webhook_no_thread", shm_user_id=payload.shm_user_id)
            return {"ok": True, "stored": False}

        now = datetime.now(timezone.utc)
        stmt = (
            pg_insert(SupportMessage)
            .values(
                user_id=thread.user_id,
                direction=payload.direction,
                author="staff" if payload.direction == "out" else "customer",
                body=body,
                external_id=payload.external_id,
                delivery="na",
            )
            .on_conflict_do_nothing(constraint="uq_support_msg_external")
            .returning(SupportMessage)
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return {"ok": True, "stored": False, "duplicate": True}

        thread.ticket_id = thread.ticket_id or payload.ticket_id
        thread.last_message_at = now
        if payload.direction == "out":
            thread.last_staff_message_at = now
            if not payload.delivered_telegram:
                # Клиенту ответ ещё не доехал: если он не вернётся в кабинет,
                # дубль отправит фоновая джоба.
                thread.notify_after = now + timedelta(seconds=settings.SUPPORT_FANOUT_DELAY_S)
            db.add(
                NotificationInbox(
                    user_id=thread.user_id,
                    type="support.reply",
                    payload={"title": "Ответ поддержки", "body": body[:120]},
                )
            )
        return {"ok": True, "stored": True, "message_id": row.id}
