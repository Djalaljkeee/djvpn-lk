"""Support chat: вложения (support_attachment)

Revision ID: 0003_support_attachments
Revises: 0002_support_chat
Create Date: 2026-08-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0003_support_attachments"
down_revision: Union[str, None] = "0002_support_chat"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_attachment",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="document"),
        sa.Column("file_name", sa.String(length=160), nullable=False),
        sa.Column("mime", sa.String(length=96), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("tg_file_id", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # Чистка переписки по ретенции удаляет файлы вместе с сообщениями.
        sa.ForeignKeyConstraint(
            ["message_id"], ["support_message.id"], name="fk_support_attachment_message",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("message_id", name="uq_support_attachment_message"),
    )
    op.create_index("ix_support_attachment_user_id", "support_attachment", ["user_id"])

    # user_id треда приходит из SHM, а не выдаётся базой: single-column integer
    # PK по умолчанию получает serial, и INSERT без user_id молча создал бы тред
    # с чужим id (1, 2, 3…). Приложение всегда передаёт его явно — убираем
    # заряженное ружьё.
    op.execute("ALTER TABLE support_thread ALTER COLUMN user_id DROP DEFAULT")
    op.execute("DROP SEQUENCE IF EXISTS support_thread_user_id_seq")


def downgrade() -> None:
    op.execute(
        "CREATE SEQUENCE IF NOT EXISTS support_thread_user_id_seq "
        "OWNED BY support_thread.user_id"
    )
    op.execute(
        "ALTER TABLE support_thread ALTER COLUMN user_id "
        "SET DEFAULT nextval('support_thread_user_id_seq')"
    )
    op.drop_index("ix_support_attachment_user_id", table_name="support_attachment")
    op.drop_table("support_attachment")
