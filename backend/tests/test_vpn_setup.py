"""Тесты выбора витрины App Store и сборки ответа /vpn/setup."""

from __future__ import annotations

import pytest

from vpn_setup import (
    APPSTORE_HAPP_INTL,
    APPSTORE_HAPP_RU,
    HAPP_DOWNLOADS,
    build_setup_response,
    detect_store_region,
)


SUB_URL = "https://vpn.example.com/sub/abc123"


class FakeRequest:
    """Минимальная заглушка Request — build_setup_response читает только headers."""

    def __init__(self, **headers):
        self.headers = {k.replace("_", "-"): v for k, v in headers.items()}


@pytest.mark.parametrize(
    "accept_language, expected",
    [
        ("ru-RU,ru;q=0.9,en;q=0.8", "ru"),
        ("ru", "ru"),
        ("RU-ru", "ru"),
        # Русский вторым приоритетом — витрина у такого пользователя не российская
        ("en-US,ru;q=0.9", "intl"),
        ("en-US,en;q=0.9", "intl"),
        ("tr-TR", "intl"),
        ("", "intl"),
        # "rue" (русинский) не должен считаться русской витриной
        ("rue", "intl"),
    ],
)
def test_detect_store_region(accept_language, expected):
    assert detect_store_region(accept_language) == expected


def test_ios_ru_locale_gets_ru_store_first():
    data = build_setup_response(SUB_URL, FakeRequest(accept_language="ru-RU,ru;q=0.9"), "ios")
    step1 = data["step1"]

    assert step1["download_url"] == APPSTORE_HAPP_RU
    assert step1["download_url_alt"] == APPSTORE_HAPP_INTL
    assert step1["download_alt_label"]


def test_ios_foreign_locale_gets_intl_store_first():
    data = build_setup_response(SUB_URL, FakeRequest(accept_language="en-US,en;q=0.9"), "ios")
    step1 = data["step1"]

    assert step1["download_url"] == APPSTORE_HAPP_INTL
    assert step1["download_url_alt"] == APPSTORE_HAPP_RU
    assert step1["download_alt_label"]


def test_macos_follows_the_same_two_store_rule():
    ru = build_setup_response(SUB_URL, FakeRequest(accept_language="ru"), "macos")["step1"]
    intl = build_setup_response(SUB_URL, FakeRequest(accept_language="de-DE"), "macos")["step1"]

    assert ru["download_url"] == intl["download_url_alt"] == APPSTORE_HAPP_RU
    assert intl["download_url"] == ru["download_url_alt"] == APPSTORE_HAPP_INTL


@pytest.mark.parametrize("platform", ["android", "windows"])
def test_platforms_without_second_store_have_no_alt_link(platform):
    step1 = build_setup_response(SUB_URL, FakeRequest(accept_language="en-US"), platform)["step1"]

    assert step1["download_url"] == HAPP_DOWNLOADS[platform]
    assert step1["download_url_alt"] is None
    assert step1["download_alt_label"] is None


def test_unknown_platform_falls_back_to_windows_build():
    step1 = build_setup_response(SUB_URL, FakeRequest(), "linux")["step1"]

    assert step1["download_url"] == HAPP_DOWNLOADS["windows"]
    assert step1["download_url_alt"] is None


def test_works_with_real_starlette_request():
    """Заглушка выше — dict; проверяем и настоящий ASGI-путь до request.headers."""
    from starlette.requests import Request

    def asgi_request(accept_language: str) -> Request:
        return Request({
            "type": "http",
            "headers": [
                (b"user-agent", b"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
                (b"accept-language", accept_language.encode()),
            ],
        })

    ru = build_setup_response(SUB_URL, asgi_request("ru-RU,ru;q=0.9"), None)
    intl = build_setup_response(SUB_URL, asgi_request("tr-TR"), None)

    assert ru["platform"] == intl["platform"] == "ios"
    assert ru["step1"]["download_url"] == APPSTORE_HAPP_RU
    assert intl["step1"]["download_url"] == APPSTORE_HAPP_INTL


def test_platform_detected_from_user_agent_when_not_forced():
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    data = build_setup_response(SUB_URL, FakeRequest(user_agent=ua, accept_language="ru"), None)

    assert data["platform"] == "ios"
    assert data["step1"]["download_url"] == APPSTORE_HAPP_RU
