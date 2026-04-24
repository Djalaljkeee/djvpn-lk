"""ORM models.

Кабинет остаётся stateless-прокси к SHM — здесь хранится только то,
чего в SHM нет:
  - `UserSettings` — пользовательские предпочтения кабинета (язык, нотификации)
  - `CartState` — выбранная услуга, которую нужно завершить после топ-апа
  - `NotificationInbox` — in-app уведомления (звонок/баджи)
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from db.base import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="ru")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Europe/Moscow")
    notification_prefs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    onboarding_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


class CartState(Base):
    __tablename__ = "cart_state"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


class NotificationInbox(Base):
    __tablename__ = "notification_inbox"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("ix_notification_user_created", "user_id", "created_at"),
    )
