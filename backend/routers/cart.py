"""User cart: сохраняем выбранный тариф, который ждёт топапа.

Эндпоинты no-op, если БД отключена — фронт обработает это как «корзина пуста».
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db import db_enabled, get_db_session
from db.models import CartState
from logging_config import get_logger
from security import get_current_session


router = APIRouter()
log = get_logger("cart")


class CartPayload(BaseModel):
    """Содержимое корзины. Поля гибкие, чтобы фронт мог расширять
    без миграций — храним всё внутри JSONB."""

    service_id: int
    service_name: Optional[str] = None
    cost: Optional[float] = None
    amount_needed: Optional[float] = None
    balance: Optional[float] = None


class CartOut(BaseModel):
    empty: bool = True
    payload: Optional[CartPayload] = None
    updated_at: Optional[str] = None


@router.get("/api/user/cart", response_model=CartOut)
async def get_cart(session: dict = Depends(get_current_session)):
    if not db_enabled():
        return CartOut(empty=True)
    user_id = session.get("user_id", 0)
    if not user_id:
        return CartOut(empty=True)

    async for db in _db():
        row = (await db.execute(select(CartState).where(CartState.user_id == user_id))).scalar_one_or_none()
        if not row:
            return CartOut(empty=True)
        return CartOut(
            empty=False,
            payload=CartPayload(**row.payload),
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


@router.put("/api/user/cart", response_model=CartOut)
async def put_cart(payload: CartPayload, session: dict = Depends(get_current_session)):
    if not db_enabled():
        # Без БД корзину нечем хранить — отдаём 503, чтобы фронт не молча терял выбор
        raise HTTPException(status_code=503, detail="Корзина недоступна: БД не настроена")
    user_id = session.get("user_id", 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="Нет user_id в сессии")

    data = payload.model_dump(exclude_none=True)
    async for db in _db():
        stmt = (
            pg_insert(CartState)
            .values(user_id=user_id, payload=data)
            .on_conflict_do_update(
                index_elements=[CartState.user_id],
                set_={"payload": data},
            )
            .returning(CartState)
        )
        row = (await db.execute(stmt)).scalar_one()
        return CartOut(
            empty=False,
            payload=CartPayload(**row.payload),
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


@router.delete("/api/user/cart", status_code=204)
async def delete_cart(session: dict = Depends(get_current_session)):
    if not db_enabled():
        return
    user_id = session.get("user_id", 0)
    if not user_id:
        return

    from sqlalchemy import delete
    async for db in _db():
        await db.execute(delete(CartState).where(CartState.user_id == user_id))


# ---- helpers ---------------------------------------------------------------

async def _db():
    """Локальный alias, чтобы не плодить Depends() в каждом обработчике."""
    async for session in get_db_session():
        yield session
