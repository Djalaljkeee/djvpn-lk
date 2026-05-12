"""Telegram OAuth verification (Login Widget)."""

import hashlib
import hmac
import logging
import time

from config import settings
from models import TelegramAuthRequest


def verify_telegram_auth(data: TelegramAuthRequest) -> bool:
    """Верификация данных от Telegram Login Widget.
    Все поля кроме hash включаются в строку проверки (Telegram docs).
    """
    bot_token = settings.TELEGRAM_BOT_TOKEN.strip()
    if not bot_token:
        logging.error("TG auth: TELEGRAM_BOT_TOKEN не задан в .env!")
        return False

    # Собираем все присланные поля (кроме hash) в порядке алфавита
    fields: dict[str, str] = {"auth_date": str(data.auth_date), "id": str(data.id)}
    if data.first_name:  fields["first_name"]  = data.first_name
    if data.last_name:   fields["last_name"]   = data.last_name
    if data.username:    fields["username"]     = data.username
    if data.photo_url:   fields["photo_url"]   = data.photo_url

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    age = time.time() - data.auth_date
    logging.info(
        "TG verify: id=%s fields=%s age=%.0fs expected=%s...  got=%s...",
        data.id, list(fields.keys()), age, expected_hash[:8], data.hash[:8]
    )

    if age > 86400:
        logging.warning("TG auth: auth_date устарел на %.0f сек", age)
        return False

    ok = hmac.compare_digest(expected_hash, data.hash)
    if not ok:
        logging.warning("TG auth: хэш не совпал для id=%s", data.id)
    return ok
