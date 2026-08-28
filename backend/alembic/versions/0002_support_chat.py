"""Support chat: support_thread, support_message

Revision ID: 0002_support_chat
Revises: 0001_initial
Create Date: 2026-08-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0002_support_chat"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_thread",
        sa.Column("user_id", sa.BigInteger(), primary_key=True),
        sa.Column("ticket_id", sa.Integer(), nullable=True),
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("customer_name", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_staff_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notify_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_support_thread_ticket", "support_thread", ["ticket_id"])
    op.create_index("ix_support_thread_notify", "support_thread", ["notify_after"])

    op.create_table(
        "support_message",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("direction", sa.String(length=3), nullable=False),
        sa.Column("author", sa.String(length=16), nullable=False, server_default="customer"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("client_msg_id", sa.String(length=64), nullable=True),
        sa.Column("external_id", sa.String(length=64), nullable=True),
        sa.Column("delivery", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "client_msg_id", name="uq_support_msg_client"),
        sa.UniqueConstraint("user_id", "external_id", name="uq_support_msg_external"),
    )
    op.create_index("ix_support_message_user_id", "support_message", ["user_id"])
    op.create_index("ix_support_msg_user_id_id", "support_message", ["user_id", "id"])
    op.create_index("ix_support_msg_outbox", "support_message", ["delivery", "next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_support_msg_outbox", table_name="support_message")
    op.drop_index("ix_support_msg_user_id_id", table_name="support_message")
    op.drop_index("ix_support_message_user_id", table_name="support_message")
    op.drop_table("support_message")
    op.drop_index("ix_support_thread_notify", table_name="support_thread")
    op.drop_index("ix_support_thread_ticket", table_name="support_thread")
    op.drop_table("support_thread")
