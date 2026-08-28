"""ORM models.

Кабинет остаётся stateless-прокси к SHM — здесь хранится только то,
чего в SHM нет:
  - `UserSettings` — пользовательские предпочтения кабинета (язык, нотификации)
  - `CartState` — выбранная услуга, которую нужно завершить после топ-апа
  - `NotificationInbox` — in-app уведомления (звонок/баджи)
  - `SupportThread` / `SupportMessage` — переписка с поддержкой: тикеты живут в
    боте, а история нужна клиенту в кабинете (после F5 и с другого устройства)
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
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


class SupportThread(Base):
    """Переписка клиента с поддержкой. Один тред на пользователя.

    Тикеты и темы форума живут в боте поддержки — здесь только то, что нужно
    кабинету: за какой тикет мы зацепились, куда дублировать ответ, если клиент
    ушёл, и что он уже прочитал.
    """

    __tablename__ = "support_thread"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # ticketId в боте. Появляется после первого успешного вызова моста.
    ticket_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_staff_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Когда клиент последний раз забирал сообщения — по нему решаем, нужен ли
    # дубль ответа в Telegram.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notify_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("ix_support_thread_ticket", "ticket_id"),
        Index("ix_support_thread_notify", "notify_after"),
    )


class SupportMessage(Base):
    """Одно сообщение переписки. `direction`: in — от клиента, out — от поддержки."""

    __tablename__ = "support_message"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    author: Mapped[str] = mapped_column(String(16), nullable=False, default="customer")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Идемпотентность: клиентская для исходящих, ботовая для входящих.
    client_msg_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # queued -> sent | failed (исходящие); na — для ответов поддержки.
    delivery: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "client_msg_id", name="uq_support_msg_client"),
        UniqueConstraint("user_id", "external_id", name="uq_support_msg_external"),
        Index("ix_support_msg_user_id_id", "user_id", "id"),
        Index("ix_support_msg_outbox", "delivery", "next_attempt_at"),
    )
