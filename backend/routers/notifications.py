"""In-app inbox-уведомления. Всё no-op, если БД выключена."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, func, select, update

from db import db_enabled, get_db_session
from db.models import NotificationInbox
from security import get_current_session


router = APIRouter()


class NotificationOut(BaseModel):
    id: int
    type: str
    payload: dict
    read_at: Optional[str] = None
    created_at: str


class InboxOut(BaseModel):
    items: List[NotificationOut] = []
    unread: int = 0


@router.get("/api/user/notifications", response_model=InboxOut)
async def list_notifications(
    limit: int = 20,
    session: dict = Depends(get_current_session),
):
    if not db_enabled():
        return InboxOut()
    user_id = session.get("user_id", 0)
    if not user_id:
        return InboxOut()

    limit = max(1, min(int(limit or 20), 100))

    async for db in _db():
        rows = (
            await db.execute(
                select(NotificationInbox)
                .where(NotificationInbox.user_id == user_id)
                .order_by(desc(NotificationInbox.created_at))
                .limit(limit)
            )
        ).scalars().all()
        unread = (
            await db.execute(
                select(func.count())
                .select_from(NotificationInbox)
                .where(
                    NotificationInbox.user_id == user_id,
                    NotificationInbox.read_at.is_(None),
                )
            )
        ).scalar_one()

        items = [
            NotificationOut(
                id=row.id,
                type=row.type,
                payload=row.payload,
                read_at=row.read_at.isoformat() if row.read_at else None,
                created_at=row.created_at.isoformat(),
            )
            for row in rows
        ]
        return InboxOut(items=items, unread=int(unread))


@router.post("/api/user/notifications/{notif_id}/read")
async def mark_read(notif_id: int, session: dict = Depends(get_current_session)):
    if not db_enabled():
        raise HTTPException(status_code=503, detail="Уведомления недоступны: БД не настроена")
    user_id = session.get("user_id", 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="Нет user_id в сессии")

    async for db in _db():
        result = await db.execute(
            update(NotificationInbox)
            .where(
                NotificationInbox.id == notif_id,
                NotificationInbox.user_id == user_id,
                NotificationInbox.read_at.is_(None),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        return {"ok": True, "updated": result.rowcount or 0}


@router.post("/api/user/notifications/read-all")
async def mark_all_read(session: dict = Depends(get_current_session)):
    if not db_enabled():
        raise HTTPException(status_code=503, detail="Уведомления недоступны: БД не настроена")
    user_id = session.get("user_id", 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="Нет user_id в сессии")

    async for db in _db():
        result = await db.execute(
            update(NotificationInbox)
            .where(
                NotificationInbox.user_id == user_id,
                NotificationInbox.read_at.is_(None),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        return {"ok": True, "updated": result.rowcount or 0}


async def _db():
    async for session in get_db_session():
        yield session
