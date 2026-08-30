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


def test_safe_file_name_strips_paths_and_control_chars():
    from routers.support import _safe_file_name

    assert _safe_file_name("../../etc/passwd") == "etcpasswd"
    assert _safe_file_name("скрин\n2026.png") == "скрин2026.png"
    # Пустое имя всё равно должно быть чем-то: оно едет в подпись в Telegram.
    assert _safe_file_name("   ") == "file"
    assert len(_safe_file_name("x" * 300)) == 160


def test_safe_mime_rejects_garbage():
    from routers.support import _safe_mime

    assert _safe_mime("image/png") == "image/png"
    assert _safe_mime("IMAGE/PNG") == "image/png"
    # Заголовок пишет клиент: всё, что не выглядит как mime, обезвреживаем.
    assert _safe_mime("image/png; charset=<script>") == "application/octet-stream"
    assert _safe_mime("") == "application/octet-stream"


def test_kind_photo_only_for_renderable_images():
    from routers.support import _kind_for

    assert _kind_for("image/png", "a.png") == "photo"
    assert _kind_for("", "скрин.JPEG") == "photo"
    # svg рисуется браузером как документ со скриптами — только вложением.
    assert _kind_for("image/svg+xml", "a.svg") == "document"
    assert _kind_for("application/pdf", "a.pdf") == "document"


def test_bridge_marks_client_errors_permanent():
    import httpx

    import support_bridge

    def parse(status: int):
        try:
            support_bridge._parse(httpx.Response(status, json={}))
        except support_bridge.BridgeError as exc:
            return str(exc), exc.permanent
        return None

    assert parse(403) == ("banned", True)
    # Файл больше лимита моста: тот же байт-в-байт повтор получит тот же ответ.
    assert parse(413) == ("http 413", True)
    # А это лечится починкой моста — сообщение остаётся в очереди.
    assert parse(502) == ("http 502", False)
    assert parse(401) == ("http 401", False)
