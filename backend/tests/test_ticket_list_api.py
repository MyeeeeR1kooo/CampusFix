"""Real list HTTP evidence for the approved literal, case-insensitive search.

Auth cookies, PostgreSQL migrations and the registered business endpoints are
real. Query fixtures do not stand in for creation; the final test also exercises
the actual create/list/detail/cancel chain. No browser or download claim is made.
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Location, Ticket, User
from test_ticket_creation_api import creation_app, fields, login, submit  # noqa: F401
from test_ticket_detail_api import (
    ORIGIN, assert_error, assert_no_private_keys, client_for, detail_app,
)  # noqa: F401 -- shared real-auth app and helpers
from test_ticket_reads import (
    STAMP, assert_component, pg_engine, read_contract_registry, read_data,
)  # noqa: F401 -- shared disposable migrated PostgreSQL fixtures


def listed(response, registry):
    assert response.status_code == 200, response.text
    payload = response.json()
    assert_component(payload, "TicketList", registry)
    assert response.headers["x-request-id"].startswith("req_")
    assert_no_private_keys(payload)
    return payload


def ids(payload):
    return [item["id"] for item in payload["items"]]


def test_list_role_scope_and_workflow_projection_without_origin(
    detail_app, read_data, read_contract_registry,
):
    expected = {
        "REPORTER": [7, 6, 5, 4, 2, 0],
        "OTHER_REPORTER": [3, 1],
        "TECHNICIAN": [7, 4, 3, 2],
        "OTHER_TECHNICIAN": [5],
        "ADMIN": [7, 6, 5, 4, 3, 2, 0, 1],
    }
    for role, indices in expected.items():
        with client_for(detail_app, read_data, role) as client:
            payload = listed(client.get("/api/tickets"), read_contract_registry)
            assert ids(payload) == [read_data.ids[index] for index in indices]
            assert payload["next_cursor"] is None
            assert all("description" not in item and "timeline" not in item for item in payload["items"])
            if role in {"REPORTER", "TECHNICIAN", "ADMIN"}:
                closed = next(item for item in payload["items"] if item["id"] == read_data.ids[4])
                assert closed["allowed_actions"] == []
                assert closed["current_responsible_role"] is closed["next_action"] is None
            if role == "REPORTER":
                submitted = next(item for item in payload["items"] if item["id"] == read_data.ids[0])
                assert submitted["allowed_actions"] == ["CANCEL", "COMMENT_PUBLIC"]
            elif role == "TECHNICIAN":
                assigned = next(item for item in payload["items"] if item["id"] == read_data.ids[2])
                assert assigned["allowed_actions"] == ["START", "COMMENT_PUBLIC"]
            elif role == "ADMIN":
                submitted = next(item for item in payload["items"] if item["id"] == read_data.ids[0])
                assert submitted["allowed_actions"] == ["REVIEW", "COMMENT_PUBLIC", "COMMENT_ADMIN_ONLY"]
            # Even an untrusted Origin is irrelevant to this read-only endpoint.
            assert client.get("/api/tickets", headers={"Origin": "https://untrusted.example.invalid"}).status_code == 200


def test_all_seven_filter_groups_are_combined_with_and_and_utc_boundaries(
    detail_app, read_data, read_contract_registry,
):
    params = {
        "status": "ASSIGNED", "category": "LIGHTING_ELECTRICAL", "priority": "HIGH",
        "building": "Current A", "created_from": STAMP.isoformat().replace("+00:00", "Z"),
        "created_before": (STAMP + timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
        "q": "xTuRe TITLE 2", "current_assignee_id": read_data.users["TECHNICIAN"].id,
    }
    with client_for(detail_app, read_data, "ADMIN") as client:
        payload = listed(client.get("/api/tickets", params=params), read_contract_registry)
        assert ids(payload) == [read_data.ids[2]]
        for name, mismatch in (
            ("status", "SUBMITTED"), ("category", "HVAC"), ("priority", "LOW"),
            ("building", "Current B"), ("q", "no matching title"),
            ("current_assignee_id", read_data.users["OTHER_TECHNICIAN"].id),
        ):
            empty = listed(client.get("/api/tickets", params={**params, name: mismatch}), read_contract_registry)
            assert empty == {"items": [], "next_cursor": None}
        bounded = listed(client.get("/api/tickets", params={
            "created_from": "2026-10-12T03:00:00Z", "created_before": "2026-10-12T04:00:00Z",
        }), read_contract_registry)
        assert ids(bounded) == [read_data.ids[index] for index in (6, 5, 4, 3, 2, 0)]
        before = listed(client.get("/api/tickets", params={"created_before": "2026-10-12T03:00:00Z"}), read_contract_registry)
        assert ids(before) == [read_data.ids[1]]
        from_boundary = listed(client.get("/api/tickets", params={"created_from": "2026-10-12T04:00:00Z"}), read_contract_registry)
        assert ids(from_boundary) == [read_data.ids[7]]
        reversed_range = listed(client.get("/api/tickets", params={
            "created_from": "2026-10-13T00:00:00Z", "created_before": "2026-10-12T00:00:00Z",
        }), read_contract_registry)
        assert reversed_range == {"items": [], "next_cursor": None}


def test_only_admin_may_filter_current_assignee(detail_app, read_data, read_contract_registry):
    params = {"current_assignee_id": read_data.users["TECHNICIAN"].id}
    for role in ("REPORTER", "TECHNICIAN"):
        with client_for(detail_app, read_data, role) as client:
            assert_error(client.get("/api/tickets", params=params), 403, "FORBIDDEN", read_contract_registry)
    with client_for(detail_app, read_data, "ADMIN") as client:
        payload = listed(client.get("/api/tickets", params=params), read_contract_registry)
        assert ids(payload) == [read_data.ids[index] for index in (7, 4, 3, 2)]


def test_keyword_search_is_case_insensitive_literal_contains_on_code_or_title(
    detail_app, read_data, read_contract_registry,
):
    titles = {
        0: "NeedLE 100%_Done", 1: "needle 100XXdone", 2: "100%XDone",
        3: "Mixed / slash", 4: "Back\\slash", 5: "Leading  space", 6: "tail needle",
    }
    with Session(read_data.engine) as db, db.begin():
        for index, title in titles.items():
            db.execute(update(Ticket).where(Ticket.id == read_data.ids[index]).values(title=title))
    cases = (
        ("nEeDlE", (6, 0, 1)), ("cf-20261012-000003", (2,)),
        ("%_", (0,)), ("%", (2, 0)), ("_", (0,)),
        ("/", (3,)), ("Back\\slash", (4,)), ("  space", (5,)),
        (" NeedLE ", ()), ("' OR 1=1 --", ()), ("no-match", ()),
    )
    with client_for(detail_app, read_data, "ADMIN") as client:
        for keyword, indices in cases:
            payload = listed(client.get("/api/tickets", params={"q": keyword}), read_contract_registry)
            assert ids(payload) == [read_data.ids[index] for index in indices], keyword
            assert payload["next_cursor"] is None
    with client_for(detail_app, read_data, "REPORTER") as client:
        payload = listed(client.get("/api/tickets", params={"q": "nEeDlE"}), read_contract_registry)
        assert ids(payload) == [read_data.ids[6], read_data.ids[0]]
        assert listed(client.get("/api/tickets", params={"q": "100XXdone"}), read_contract_registry) == {
            "items": [], "next_cursor": None,
        }


def test_pagination_defaults_to_twenty_caps_at_hundred_and_seeks_tied_timestamps(
    detail_app, read_data, read_contract_registry,
):
    with Session(read_data.engine) as db, db.begin():
        rows = [Ticket(
            code=f"CF-20261022-{1000 + index:06d}", reporter_id=read_data.users["REPORTER"].id,
            location_id=read_data.locations[0].id, location_label_snapshot="Page fixture snapshot",
            title=f"Page fixture {index}", description="Query fixture only, not creation evidence",
            category="FURNITURE", priority=None, status="SUBMITTED", current_assignee_id=None,
            version=1, created_at=STAMP + timedelta(days=1), updated_at=STAMP + timedelta(days=1), closed_at=None,
        ) for index in range(105)]
        db.add_all(rows)
        db.flush()
        new_ids = [row.id for row in rows]
    expected = list(reversed(new_ids)) + [read_data.ids[index] for index in (7, 6, 5, 4, 2, 0)]
    with client_for(detail_app, read_data, "REPORTER") as client:
        first = listed(client.get("/api/tickets"), read_contract_registry)
        assert len(first["items"]) == 20 and first["next_cursor"]
        assert ids(first) == expected[:20]
        rest = listed(client.get("/api/tickets", params={"cursor": first["next_cursor"], "limit": 100}), read_contract_registry)
        assert ids(rest) == expected[20:] and rest["next_cursor"] is None
        maximum = listed(client.get("/api/tickets", params={"limit": 100}), read_contract_registry)
        assert len(maximum["items"]) == 100 and ids(maximum) == expected[:100]
        tail = listed(client.get("/api/tickets", params={"limit": 100, "cursor": maximum["next_cursor"]}), read_contract_registry)
        assert ids(tail) == expected[100:] and tail["next_cursor"] is None
        assert len(set(ids(maximum) + ids(tail))) == len(expected)


def test_cursor_is_bound_to_user_and_filters_and_rejects_tampering(
    detail_app, read_data, read_contract_registry,
):
    with client_for(detail_app, read_data, "ADMIN") as admin:
        first = listed(admin.get("/api/tickets", params={"q": "Fixture", "limit": 1}), read_contract_registry)
        cursor = first["next_cursor"]
        assert cursor
        valid = listed(admin.get("/api/tickets", params={"q": "Fixture", "cursor": cursor, "limit": 2}), read_contract_registry)
        assert ids(first)[0] not in ids(valid)
        for params in (
            {"q": "Fixture", "cursor": cursor[:-1] + ("A" if cursor[-1] != "A" else "B")},
            {"q": "changed", "cursor": cursor},
            {"q": "Fixture", "status": "SUBMITTED", "cursor": cursor},
            {"q": "Fixture", "cursor": "invalid-cursor"},
            {"q": "Fixture", "cursor": "x" * 513},
        ):
            assert_error(admin.get("/api/tickets", params=params), 400, "VALIDATION_ERROR", read_contract_registry)
    with client_for(detail_app, read_data, "REPORTER") as other:
        assert_error(other.get("/api/tickets", params={"q": "Fixture", "cursor": cursor}), 400, "VALIDATION_ERROR", read_contract_registry)


def test_list_authentication_rejects_anonymous_expired_and_disabled_sessions(
    detail_app, read_data, read_contract_registry,
):
    with TestClient(detail_app) as anonymous:
        assert_error(anonymous.get("/api/tickets"), 401, "UNAUTHORIZED", read_contract_registry)
    with client_for(
        detail_app, read_data, "REPORTER", expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    ) as expired:
        assert_error(expired.get("/api/tickets"), 401, "UNAUTHORIZED", read_contract_registry)
    with client_for(detail_app, read_data, "REPORTER") as disabled:
        with Session(read_data.engine) as db, db.begin():
            db.execute(update(User).where(User.id == read_data.users["REPORTER"].id).values(active=False))
        assert_error(disabled.get("/api/tickets"), 401, "UNAUTHORIZED", read_contract_registry)


def test_query_validation_preserves_raw_utc_and_frozen_parameter_bounds(
    detail_app, read_data, read_contract_registry,
):
    invalid = (
        {"q": ""}, {"building": ""}, {"cursor": ""}, {"limit": 0}, {"limit": 101},
        {"status": "UNKNOWN"}, {"category": "UNKNOWN"}, {"priority": "UNKNOWN"},
        {"current_assignee_id": 0}, {"current_assignee_id": 2**63},
        {"created_from": "2026-10-12T03:00:00+00:00"},
        {"created_before": "2026-10-12T03:00:00"}, {"created_from": "1791774000"},
        {"unknown_filter": "not-approved"},
    )
    with client_for(detail_app, read_data, "ADMIN") as client:
        for params in invalid:
            response = client.get("/api/tickets", params=params)
            assert_error(response, 422, "VALIDATION_ERROR", read_contract_registry)
            assert response.json()["error"]["field_errors"], params


def test_building_filter_reads_current_disabled_location_but_displays_saved_snapshot(
    detail_app, read_data, read_contract_registry,
):
    with Session(read_data.engine) as db, db.begin():
        db.execute(update(Location).where(Location.id == read_data.locations[0].id).values(
            building="Renamed Current A", active=False,
        ))
    with client_for(detail_app, read_data, "ADMIN") as client:
        payload = listed(client.get("/api/tickets", params={"building": "Renamed Current A"}), read_contract_registry)
        assert ids(payload) == [read_data.ids[index] for index in (6, 5, 2, 0)]
        assert all(item["location_label_snapshot"] == "Historical 0 / 9 / old" for item in payload["items"])
        assert listed(client.get("/api/tickets", params={"building": "Current A"}), read_contract_registry) == {
            "items": [], "next_cursor": None,
        }


def test_real_create_list_detail_cancel_chain(creation_app, read_contract_registry):
    data = creation_app
    reporter = login(data.app, "REPORTER")
    created = submit(reporter, fields(data, title="Unique Flow Report"))
    assert created.status_code == 201, created.text
    ticket_id = created.json()["id"]
    initial = listed(reporter.get("/api/tickets", params={"q": "flow REPORT"}), read_contract_registry)
    assert ids(initial) == [ticket_id]
    assert initial["items"][0]["version"] == 1
    assert reporter.get(created.headers["location"]).status_code == 200
    cancelled = reporter.post(
        created.headers["location"] + "/cancel", json={"expected_version": 1}, headers={"Origin": ORIGIN},
    )
    assert cancelled.status_code == 200, cancelled.text
    final = listed(reporter.get("/api/tickets", params={"q": "flow report", "status": "CANCELLED"}), read_contract_registry)
    assert ids(final) == [ticket_id]
    assert (final["items"][0]["version"], final["items"][0]["allowed_actions"]) == (2, [])
    assert listed(reporter.get("/api/tickets", params={"q": "flow report", "status": "SUBMITTED"}), read_contract_registry) == {
        "items": [], "next_cursor": None,
    }
