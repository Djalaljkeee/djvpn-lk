"""Чат поддержки в кабинете.

Тикеты и темы форума живут в боте поддержки — кабинет держит только историю
переписки для клиента и мост к боту. Всё no-op, если БД выключена.

Транспорт до браузера — обычный поллинг: uvicorn запущен одним воркером с
`--limit-concurrency 200`, и сотня открытых websocket'ов съела бы этот бюджет,
после чего кабинет перестал бы отвечать всем целиком.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import asc, desc, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

import support_bridge
from config import settings
from db import db_enabled, get_db_session
from db.models import NotificationInbox, SupportAttachment, SupportMessage, SupportThread
from logging_config import get_logger
from rate_limit import limiter, session_key_func
from security import get_current_session
from shm_client import shm_request


router = APIRouter()
log = get_logger("support")

MAX_TEXT = 4000
# Telegram обрезает подпись к файлу на 1024 символах.
MAX_CAPTION = 1000
IDENTITY_TTL = timedelta(hours=24)
# Управляющие символы ломают вставку в postgres и ничего не значат в чате.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Имя файла показывается клиенту и уезжает в подпись в Telegram: режем всё,
# что похоже на путь, и всю управляющую мелочь.
_FILENAME_BAD_RE = re.compile(r"[\x00-\x1f\x7f/\\\r\n\t]")
# Картинки, которые браузеру безопасно отдать inline. Всё остальное уходит
# вложением с octet-stream: mime приходит от клиента, и inline text/html или
# svg — это XSS на домене кабинета.
_INLINE_MIME = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})


# --------------------------------------------------------------------------- #
# Схемы
# --------------------------------------------------------------------------- #

class SupportAttachmentOut(BaseModel):
    id: int
    kind: str
    name: str
    mime: str
    size: int


class SupportMessageOut(BaseModel):
    id: int
    direction: str
    author: str
    body: str
    delivery: str
    created_at: str
    attachment: Optional[SupportAttachmentOut] = None


class SupportThreadOut(BaseModel):
    enabled: bool = True
    status: str = "open"
    ticket_id: Optional[int] = None
    unread: int = 0
    last_message_at: Optional[str] = None
    # Предел вложения — виджету, чтобы отказать большому файлу до отправки.
    max_upload_mb: int = Field(default_factory=lambda: settings.SUPPORT_MAX_UPLOAD_MB)


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


class BotFileIn(BaseModel):
    name: str = Field(max_length=256)
    mime: str = Field(default="application/octet-stream", max_length=96)
    size: int = 0
    #: Содержимое файла, base64 — см. support_bridge.send_file.
    data_b64: str
    tg_file_id: Optional[str] = Field(default=None, max_length=160)


class BotWebhookFileIn(BotWebhookIn):
    file: BotFileIn


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


def _as_out(
    row: SupportMessage, attachment: Optional[SupportAttachmentOut] = None
) -> SupportMessageOut:
    return SupportMessageOut(
        id=row.id,
        direction=row.direction,
        author=row.author,
        body=row.body,
        delivery=row.delivery,
        created_at=_iso(row.created_at) or "",
        attachment=attachment,
    )


def _max_upload_bytes() -> int:
    return max(1, int(settings.SUPPORT_MAX_UPLOAD_MB)) * 1024 * 1024


def _kind_for(mime: str, name: str) -> str:
    """photo — картинка, её кабинет рисует прямо в переписке; всё прочее — document."""
    if (mime or "").lower() in _INLINE_MIME:
        return "photo"
    if not mime and re.search(r"\.(jpe?g|png|webp|gif)$", name or "", re.I):
        return "photo"
    return "document"


def _safe_file_name(name: str) -> str:
    """Имя файла без путей и управляющих символов, не длиннее колонки."""
    cleaned = _FILENAME_BAD_RE.sub("", (name or "").strip()).lstrip(".")
    return (cleaned or "file")[:160]


def _safe_mime(mime: str) -> str:
    mime = (mime or "").strip().lower()
    return mime[:96] if re.fullmatch(r"[\w.+-]+/[\w.+-]+", mime or "") else "application/octet-stream"


async def _attachments_for(db, message_ids: List[int]) -> Dict[int, SupportAttachmentOut]:
    """Карточки вложений для списка сообщений — без самих байт.

    `SupportAttachment.data` тянуть в список переписки нельзя: пятьдесят
    сообщений со скриншотами — это полтабуна мегабайт на каждый поллинг.
    """
    if not message_ids:
        return {}
    rows = (
        await db.execute(
            select(
                SupportAttachment.id,
                SupportAttachment.message_id,
                SupportAttachment.kind,
                SupportAttachment.file_name,
                SupportAttachment.mime,
                SupportAttachment.size,
            ).where(SupportAttachment.message_id.in_(message_ids))
        )
    ).all()
    return {
        row.message_id: SupportAttachmentOut(
            id=row.id, kind=row.kind, name=row.file_name, mime=row.mime, size=row.size
        )
        for row in rows
    }


async def _attachment_out(db, message_id: int) -> Optional[SupportAttachmentOut]:
    return (await _attachments_for(db, [message_id])).get(message_id)


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
    """Пробует отдать сообщение боту. Неудача — не ошибка: добьёт outbox-джоба.

    Вложение ищется здесь, а не передаётся аргументом: ретрай из джобы знает
    только сообщение, и так у файла и текста остаётся один путь доставки.
    """
    attachment = (
        await db.execute(
            select(SupportAttachment).where(SupportAttachment.message_id == message.id)
        )
    ).scalar_one_or_none()
    client_msg_id = message.client_msg_id or str(message.id)
    try:
        if attachment is not None:
            result = await support_bridge.send_file(
                shm_user_id=thread.user_id,
                telegram_id=thread.telegram_chat_id,
                name=thread.customer_name,
                caption=message.body,
                client_msg_id=client_msg_id,
                file_name=attachment.file_name,
                mime=attachment.mime,
                data=attachment.data,
            )
        else:
            result = await support_bridge.send_message(
                shm_user_id=thread.user_id,
                telegram_id=thread.telegram_chat_id,
                name=thread.customer_name,
                text=message.body,
                client_msg_id=client_msg_id,
            )
    except support_bridge.BridgeError as exc:
        reason = str(exc)
        message.attempts = (message.attempts or 0) + 1
        message.error = reason[:256]
        if reason == "banned":
            message.delivery = "failed"
            thread.status = "banned"
        elif exc.permanent:
            # Мост нас понял и отказал — повтор вернёт тот же ответ.
            message.delivery = "failed"
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

        attachments = await _attachments_for(db, [r.id for r in rows])
        return SupportListOut(
            thread=await _thread_out(db, thread),
            items=[_as_out(r, attachments.get(r.id)) for r in rows],
        )


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


@router.post("/api/support/attachments", response_model=SupportMessageOut)
@limiter.limit("6/minute", key_func=session_key_func)
async def upload_attachment(
    request: Request,
    file: UploadFile = File(...),
    client_msg_id: str = Form(..., min_length=8, max_length=64),
    caption: str = Form(""),
    session: dict = Depends(get_current_session),
):
    """Файл из виджета: ложится в переписку и уезжает в тему тикета.

    Байты хранятся в постгресе рядом с сообщением — см. `SupportAttachment`.
    """
    if not settings.SUPPORT_CHAT_ENABLED:
        raise HTTPException(status_code=503, detail="Чат поддержки временно недоступен")
    if not db_enabled():
        raise HTTPException(status_code=503, detail="Чат недоступен: БД не настроена")

    limit = _max_upload_bytes()
    # Читаем на байт больше лимита: так «слишком большой» видно, не утащив в
    # память весь файл целиком.
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Файл больше {settings.SUPPORT_MAX_UPLOAD_MB} МБ — пришлите его в Telegram",
        )
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")

    file_name = _safe_file_name(file.filename or "")
    mime = _safe_mime(file.content_type or "")
    text = _clean(caption)[:MAX_CAPTION]
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
                client_msg_id=client_msg_id,
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
                        SupportMessage.client_msg_id == client_msg_id,
                    )
                )
            ).scalar_one()
            return _as_out(row, await _attachment_out(db, row.id))

        await db.flush()
        db.add(
            SupportAttachment(
                message_id=row.id,
                user_id=user_id,
                kind=_kind_for(mime, file_name),
                file_name=file_name,
                mime=mime,
                size=len(data),
                data=data,
            )
        )
        thread.last_message_at = datetime.now(timezone.utc)
        await db.flush()
        await deliver_to_bot(db, thread, row)
        return _as_out(row, await _attachment_out(db, row.id))


@router.get("/api/support/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: int, session: dict = Depends(get_current_session)
):
    """Отдаёт файл переписки его владельцу.

    Inline — только для картинок известных типов: mime приходит от клиента, и
    `text/html` или svg, отданные inline, стали бы XSS на домене кабинета.
    """
    if not db_enabled():
        raise HTTPException(status_code=503, detail="Чат недоступен: БД не настроена")

    async for db in _db():
        row = (
            await db.execute(
                select(SupportAttachment).where(
                    SupportAttachment.id == attachment_id,
                    SupportAttachment.user_id == session["user_id"],
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Файл не найден")

        inline = row.mime in _INLINE_MIME
        disposition = "inline" if inline else "attachment"
        media_type = row.mime if inline else "application/octet-stream"
        return Response(
            content=row.data,
            media_type=media_type,
            headers={
                # filename* — имя может быть кириллическим, а голый filename
                # обязан быть ASCII.
                "Content-Disposition": (
                    f"{disposition}; filename*=UTF-8''{quote(row.file_name)}"
                ),
                "Content-Length": str(row.size),
                "X-Content-Type-Options": "nosniff",
                # Файл не меняется, но и в общий кэш ему нельзя: ручка приватная.
                "Cache-Control": "private, max-age=86400",
            },
        )


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

def _require_bridge_secret(request: Request) -> None:
    """Ручки бота публично достижимы (nginx проксирует весь /api/) — только секрет."""
    secret = request.headers.get("x-bridge-secret", "")
    if not settings.SUPPORT_BRIDGE_SECRET or not hmac.compare_digest(
        secret, settings.SUPPORT_BRIDGE_SECRET
    ):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not db_enabled():
        raise HTTPException(status_code=503, detail="db is off")


async def _store_from_bot(
    db, payload: BotWebhookIn, body: str, notice: str
) -> tuple[Optional[SupportThread], Optional[SupportMessage]]:
    """Кладёт сообщение бота в переписку.

    Никогда не создаёт тред: не нашли — зовущая ручка отвечает 200 и пишет лог,
    иначе бот будет вечно ретраить сообщение, которому некуда лечь.

    :returns: `(тред, сообщение)`; сообщение — None, если это дубль.
    """
    thread = (
        await db.execute(
            select(SupportThread).where(SupportThread.user_id == payload.shm_user_id)
        )
    ).scalar_one_or_none()
    if thread is None:
        log.info("support.webhook_no_thread", shm_user_id=payload.shm_user_id)
        return None, None

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
        return thread, None

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
                payload={"title": "Ответ поддержки", "body": notice[:120]},
            )
        )
    return thread, row


@router.post("/api/internal/support/incoming")
@limiter.limit("120/minute")
async def bot_webhook(request: Request, payload: BotWebhookIn, response: Response):
    """Приём сообщения от бота поддержки."""
    _require_bridge_secret(request)

    body = _clean(payload.text)
    async for db in _db():
        thread, row = await _store_from_bot(db, payload, body, body)
        if thread is None:
            return {"ok": True, "stored": False}
        if row is None:
            return {"ok": True, "stored": False, "duplicate": True}
        return {"ok": True, "stored": True, "message_id": row.id}


@router.post("/api/internal/support/incoming-file")
@limiter.limit("60/minute")
async def bot_webhook_file(request: Request, payload: BotWebhookFileIn):
    """Приём файла от бота: скриншот из Telegram — в историю кабинета.

    Тело — тот же JSON, что у текстовой ручки, плюс файл в base64. Клиент за
    ним потом придёт в `/api/support/attachments/{id}` под своей сессией.
    """
    _require_bridge_secret(request)

    try:
        data = base64.b64decode(payload.file.data_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="bad base64")
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    if len(data) > _max_upload_bytes():
        raise HTTPException(status_code=413, detail="file too large")

    body = _clean(payload.text)[:MAX_CAPTION]
    file_name = _safe_file_name(payload.file.name)
    mime = _safe_mime(payload.file.mime)

    async for db in _db():
        thread, row = await _store_from_bot(db, payload, body, body or f"\U0001f4ce {file_name}")
        if thread is None:
            return {"ok": True, "stored": False}
        if row is None:
            return {"ok": True, "stored": False, "duplicate": True}

        await db.flush()
        db.add(
            SupportAttachment(
                message_id=row.id,
                user_id=thread.user_id,
                kind=_kind_for(mime, file_name),
                file_name=file_name,
                mime=mime,
                size=len(data),
                data=data,
                tg_file_id=payload.file.tg_file_id,
            )
        )
        return {"ok": True, "stored": True, "message_id": row.id}
