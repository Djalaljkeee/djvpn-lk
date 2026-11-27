from routers.devices import _vpn_root_services


def test_addon_children_are_skipped():
    raw = [
        {"user_service_id": 2363, "service_id": 13, "parent": 2359, "status": "ACTIVE"},
        {"user_service_id": 2359, "service_id": 17, "parent": None, "status": "ACTIVE"},
        {"user_service_id": None, "service_id": 3},
        {"user_service_id": 2100, "service_id": 3},
    ]
    assert [s["user_service_id"] for s in _vpn_root_services(raw)] == [2359, 2100]
