"""Initial schema: user_settings, cart_state, notification_inbox

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.BigInteger(), primary_key=True),
        sa.Column("language", sa.String(length=8), nullable=False, server_default="ru"),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Europe/Moscow"),
        sa.Column(
            "notification_prefs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("onboarding_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "cart_state",
        sa.Column("user_id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "notification_inbox",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notification_inbox_user_id", "notification_inbox", ["user_id"])
    op.create_index("ix_notification_user_created", "notification_inbox", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_notification_user_created", table_name="notification_inbox")
    op.drop_index("ix_notification_inbox_user_id", table_name="notification_inbox")
    op.drop_table("notification_inbox")
    op.drop_table("cart_state")
    op.drop_table("user_settings")
