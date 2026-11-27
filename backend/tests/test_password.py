import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import httpx
import pytest

from routers import password
from routers.password import verify_init_data

BOT_TOKEN = "123456:TEST"


def make_init_data(tg_id: int, auth_date: int, bot_token: str = BOT_TOKEN) -> str:
    fields = {"auth_date": str(auth_date), "query_id": "AAE", "user": json.dumps({"id": tg_id})}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def test_verify_init_data_accepts_valid_signature():
    assert verify_init_data(make_init_data(42, int(time.time())), BOT_TOKEN) == 42


def test_verify_init_data_rejects_foreign_bot_and_tampering():
    data = make_init_data(42, int(time.time()), bot_token="999:OTHER")
    assert verify_init_data(data, BOT_TOKEN) is None
    good = make_init_data(42, int(time.time()))
    assert verify_init_data(good.replace("42", "43"), BOT_TOKEN) is None
    assert verify_init_data(good, "") is None


def test_verify_init_data_rejects_stale_signature():
    old = int(time.time()) - password.INIT_DATA_MAX_AGE_S - 60
    assert verify_init_data(make_init_data(42, old), BOT_TOKEN) is None


@pytest.fixture
def api(client, monkeypatch):
    import main
    from security import get_current_session

    monkeypatch.setattr(password.settings, "SHM_PASSWD_TOKEN", "tok")
    monkeypatch.setattr(password.settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(password.limiter, "enabled", False)
    main.app.dependency_overrides[get_current_session] = lambda: {"shm_session": "sid", "user_id": 1547}
    state = {"user": {"user_id": 1547, "gid": 2, "login": "@42", "settings": {"telegram": {"chat_id": 42}}}, "calls": []}

    async def fake_shm_request(method, path, session_id, **kw):
        return {"data": [state["user"]]}

    async def fake_retry(client_, method, url, *, label, **kw):
        state["calls"].append((url, kw))
        return httpx.Response(200, json={"data": [{}]})

    monkeypatch.setattr(password, "shm_request", fake_shm_request)
    monkeypatch.setattr(password, "request_with_connect_retry", fake_retry)
    yield client, state
    main.app.dependency_overrides.pop(get_current_session, None)


def test_change_password_via_token(api):
    client, state = api
    r = client.post("/api/user/password", json={"password": "newpass1", "init_data": make_init_data(42, int(time.time()))})
    assert r.status_code == 200
    url, kw = state["calls"][0]
    assert url.endswith("/shm/v1/admin/user/passwd")
    assert kw["headers"]["Authorization"] == "Bearer tok"
    assert kw["json"] == {"user_id": 1547, "password": "newpass1"}


def test_rejects_telegram_id_of_another_user(api):
    client, state = api
    r = client.post("/api/user/password", json={"password": "newpass1", "init_data": make_init_data(777, int(time.time()))})
    assert r.status_code == 403
    assert state["calls"] == []


def test_rejects_admin_group(api):
    client, state = api
    state["user"]["gid"] = 1
    r = client.post("/api/user/password", json={"password": "newpass1", "init_data": make_init_data(42, int(time.time()))})
    assert r.status_code == 403
    assert state["calls"] == []


def test_disabled_without_token(api, monkeypatch):
    client, state = api
    monkeypatch.setattr(password.settings, "SHM_PASSWD_TOKEN", "")
    r = client.post("/api/user/password", json={"password": "newpass1", "init_data": make_init_data(42, int(time.time()))})
    assert r.status_code == 503
    assert state["calls"] == []


def _post(client, tg_id=42):
    return client.post("/api/user/password", json={"password": "newpass1", "init_data": make_init_data(tg_id, int(time.time()))})


def test_shm3_client_view_without_gid_and_settings(api):
    # SHM 3.x прячет gid и settings от клиента (hide_for_user): остаётся логин.
    client, state = api
    state["user"] = {"user_id": 1547, "login": "@42"}
    assert _post(client).status_code == 200
    assert state["calls"][0][1]["json"]["user_id"] == 1547


def test_shm3_bare_telegram_login(api):
    # Новых TG-пользователей 3.x регистрирует логином без «@».
    client, state = api
    state["user"] = {"user_id": 1547, "login": "42"}
    assert _post(client).status_code == 200
    assert _post(client, tg_id=43).status_code == 403


@pytest.mark.parametrize("uid", [1, 2, 5])
def test_rejects_protected_user_even_without_gid(api, uid):
    import main
    from security import get_current_session

    client, state = api
    main.app.dependency_overrides[get_current_session] = lambda: {"shm_session": "sid", "user_id": uid}
    state["user"] = {"user_id": uid, "login": "@42"}
    assert _post(client).status_code == 403
    assert state["calls"] == []


def test_protected_list_is_configurable(api, monkeypatch):
    client, state = api
    monkeypatch.setattr(password.settings, "SHM_PASSWD_PROTECTED_USER_IDS", " 1, 1547 ,x")
    assert password.protected_user_ids() == {1, 1547}
    assert _post(client).status_code == 403
    assert state["calls"] == []
