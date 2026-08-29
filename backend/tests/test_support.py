"""Чат поддержки: нормализация текста и резолв личности клиента."""

from routers.support import _clean, _telegram_id_from


def test_clean_strips_control_chars_and_normalises_newlines():
    assert _clean("привет\r\nмир") == "привет\nмир"
    # NUL ломает вставку в postgres, а не просто выглядит мусором.
    assert _clean("текст\x00с нулём") == "текстс нулём"
    assert _clean("   \n  ") == ""


def test_clean_collapses_long_newline_runs_and_truncates():
    assert _clean("a\n\n\n\n\n\nb") == "a\n\n\nb"
    assert len(_clean("x" * 5000)) == 4000


def test_telegram_id_from_settings():
    assert _telegram_id_from("@123", {"chat_id": 456}) == 456
    assert _telegram_id_from("@123", {"user_id": "789"}) == 789


def test_telegram_id_falls_back_to_login():
    # У telegram-регистраций SHM-логин имеет вид @<telegram id>.
    assert _telegram_id_from("@345522691", {}) == 345522691


def test_telegram_id_absent_for_email_signup():
    assert _telegram_id_from("user@example.com", {}) is None
    assert _telegram_id_from("@notanumber", {}) is None
