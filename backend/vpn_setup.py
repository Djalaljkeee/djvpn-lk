"""VPN client setup helpers: platform detection, deeplinks, QR code."""

import base64
import io
from typing import Dict, NamedTuple, Optional, Tuple

import segno
from fastapi import Request


class ClientApp(NamedTuple):
    """Клиент, который кабинет предлагает поставить на конкретной платформе."""

    name: str
    #: Префикс диплинка импорта: к нему как есть приклеивается ссылка подписки.
    deeplink_scheme: str
    downloads: Dict[str, str]
    #: Запасной способ установки: платформа → (ссылка, подпись для кнопки).
    downloads_alt: Dict[str, Tuple[str, str]]


# Happ в российской витрине App Store сейчас нет ни под каким id: Apple по
# требованию РКН выпиливала клиент, разработчик перезаливал его под новым
# именем и новым id, и на 06.09.2026 мертвы обе карточки (id6788279553 и
# id6746188973). Поиск по RU-витрине выдаёт только чужие подделки «Happ VPN»
# от посторонних издателей — на них не ссылаемся.
# Живой остаётся международная карточка (Flyfrog LLC) — она есть везде, кроме
# РФ, — и десктопный .dmg с GitHub, которому витрина вообще не нужна.
# Если Happ вернётся в российскую витрину, ссылку добавлять сюда.
APPSTORE_HAPP_INTL = "https://apps.apple.com/app/happ-proxy-utility/id6504287215"
HAPP_MACOS_DMG = "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.macOS.universal.dmg"

# INCY (llc.itdev.incy) — клиент для iOS. Карточка одна и лежит в российской
# витрине, поэтому второй ссылки для него нет и «недоступно в вашем регионе»
# на iOS больше не ловим. Тот же выбор сделан на странице подписки Remnawave:
# там iOS → INCY с диплинком incy://import/.
APPSTORE_INCY = "https://apps.apple.com/ru/app/incy/id6756943388"

HAPP_DOWNLOADS = {
    "ios":     APPSTORE_HAPP_INTL,
    "android": "https://play.google.com/store/apps/details?id=com.happ.vpn",
    "windows": "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe",
    # На Mac ведём в обход App Store: универсальная сборка (Apple Silicon +
    # Intel), одна ссылка на любую страну Apple ID.
    "macos":   HAPP_MACOS_DMG,
}

HAPP = ClientApp(
    name="Happ",
    deeplink_scheme="happ://add/",
    downloads=HAPP_DOWNLOADS,
    downloads_alt={
        "macos": (APPSTORE_HAPP_INTL, "поставить из международного App Store"),
    },
)

INCY = ClientApp(
    name="INCY",
    deeplink_scheme="incy://import/",
    downloads={"ios": APPSTORE_INCY},
    downloads_alt={},
)

# Платформы, где мы выдаём не Happ. Остальные — DEFAULT_APP.
APPS_BY_PLATFORM = {
    "ios": INCY,
}
DEFAULT_APP = HAPP


def app_for_platform(platform: str) -> ClientApp:
    return APPS_BY_PLATFORM.get(platform, DEFAULT_APP)


# Ссылки сразу под все платформы: на каждой — то приложение, которое мы там
# рекомендуем. Набор платформ задаёт Happ, он есть везде.
ALL_DOWNLOADS = {
    platform: app_for_platform(platform).downloads[platform]
    for platform in HAPP_DOWNLOADS
}


def detect_platform(ua: str) -> str:
    ua = ua.lower()
    if "iphone" in ua or "ipad" in ua or "ipod" in ua:
        return "ios"
    if "android" in ua:
        return "android"
    if "mac" in ua:
        return "macos"
    return "windows"


def build_deeplink(subscription_url: str, platform: str = "") -> str:
    return f"{app_for_platform(platform).deeplink_scheme}{subscription_url}"


def generate_qr_base64(data: str) -> str:
    """QR code → PNG data-URI (base64)."""
    qr = segno.make(data)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=8, dark="#000000", light="#ffffff")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def build_setup_response(sub_url: str, request: Request, platform: Optional[str]) -> dict:
    detected = platform or detect_platform(request.headers.get("user-agent", ""))
    app = app_for_platform(detected)
    deeplink = build_deeplink(sub_url, detected)
    qr_data = generate_qr_base64(deeplink)

    # Неизвестная платформа (linux и прочее) — как и раньше, десктопный Happ.
    primary_url = app.downloads.get(detected, HAPP_DOWNLOADS["windows"])
    # Основная ссылка ни от какой витрины не зависит, поэтому угадывать страну
    # Apple ID по Accept-Language больше не нужно: запасная просто лежит рядом.
    alt_url, alt_label = app.downloads_alt.get(detected, (None, None))

    return {
        "platform": detected,
        "subscription_url": sub_url,
        "step1": {
            "title": "Скачайте приложение",
            "app_name": app.name,
            "download_url": primary_url,
            "download_url_alt": alt_url,
            "download_alt_label": alt_label,
            "all_downloads": ALL_DOWNLOADS,
        },
        "step2": {
            "title": "Подключиться",
            "deeplink": deeplink,
            "copy_link": sub_url,
            "qr_code": qr_data,
        },
        "fallback": {
            "title": "Ручная настройка",
            "instruction": (
                f"1. Откройте приложение {app.name}\n"
                "2. Нажмите «+» → «Добавить подписку»\n"
                "3. Вставьте скопированную ссылку"
            ),
            "copy_link": sub_url,
        },
    }
