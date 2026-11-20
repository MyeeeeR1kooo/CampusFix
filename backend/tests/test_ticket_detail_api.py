"""Real authenticated detail HTTP reads against disposable PostgreSQL.

The imported rows are query fixtures, not proof of ticket creation or protected
attachment downloads. No authentication or business HTTP route is substituted.
"""

import importlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.main import create_app
from app.models import Comment, Location, Session as AuthSession, Ticket, TicketEvent, User
from test_ticket_reads import (
    STAMP, assert_component, capture_sql, pg_engine, read_contract_registry, read_data,
)  # noqa: F401 -- reusable real PG fixtures


ORIGIN = "http://localhost:5173"


@pytest.fixture
def detail_app(read_data, monkeypatch):
    settings = Settings(
        _env_file=None, secret_key="detail-http-fixture-" + "x" * 32,
        allowed_origins=[ORIGIN], environment="test",
    )
    monkeypatch.setattr(importlib.import_module("app.main"), "get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings

    def test_db():
        with Session(read_data.engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    return app


@contextmanager
def client_for(app, data, role, *, expires_at=None):
    token = "detail-http-" + uuid4().hex
    with Session(data.engine) as db, db.begin():
        db.add(AuthSession(
            user_id=data.users[role].id, token_hash=hash_session_token(token),
            expires_at=expires_at or datetime.now(timezone.utc) + timedelta(hours=1),
        ))
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE_NAME, token)
        yield client


def assert_error(response, status, code, registry):
    assert response.status_code == status, response.text
    assert_component(response.json(), "ErrorResponse", registry)
    assert response.json()["error"]["code"] == code
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]


def assert_no_private_keys(value):
    if isinstance(value, dict):
        assert {"email", "password_hash", "token_hash", "storage_key", "disk_path", "active"}.isdisjoint(value)
        for nested in value.values():
            assert_no_private_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            assert_no_private_keys(nested)


def test_related_roles_get_full_contract_and_real_workflow_projection_without_origin(
    detail_app, read_data, read_contract_registry,
):
    expected_actions = {
        "REPORTER": ["COMMENT_PUBLIC"],
        "TECHNICIAN": ["START", "COMMENT_PUBLIC"],
        "ADMIN": ["COMMENT_PUBLIC", "COMMENT_ADMIN_ONLY"],
    }
    for role, actions in expected_actions.items():
        with client_for(detail_app, read_data, role) as client:
            response = client.get(f"/api/tickets/{read_data.ids[2]}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert_component(payload, "TicketDetail", read_contract_registry)
        assert response.headers["x-request-id"].startswith("req_")
        assert payload["current_responsible_role"] == "TECHNICIAN"
        assert payload["next_action"] == "START"
        assert payload["allowed_actions"] == actions
        assert payload["location_label_snapshot"] == "Historical 0 / 9 / old"
        assert payload["description"] == "Fixture description 2"
        assert_no_private_keys(payload)
        assert payload["report_photos"][0]["download_url"] == f"/api/attachments/{read_data.photos[0].id}"
        assert payload["resolution_photos"][0]["id"] == read_data.photos[1].id
        assert payload["assignments"][0]["id"] == read_data.assignments[0].id


def test_missing_and_unrelated_details_have_same_404_and_never_query_children(
    detail_app, read_data, read_contract_registry,
):
    observed = []
    for role, ticket_id in (
        ("REPORTER", max(read_data.ids) + 10000),
        ("REPORTER", read_data.ids[3]),
        ("OTHER_REPORTER", read_data.ids[2]),
        ("OTHER_TECHNICIAN", read_data.ids[2]),
        ("TECHNICIAN", read_data.ids[0]),
    ):
        with client_for(detail_app, read_data, role) as client, capture_sql(read_data.engine) as queries:
            response = client.get(f"/api/tickets/{ticket_id}")
        assert_error(response, 404, "NOT_FOUND", read_contract_registry)
        error = response.json()["error"]
        observed.append({key: value for key, value in error.items() if key != "request_id"})
        sql = " ".join(statement.lower() for statement, _ in queries)
        assert all(table not in sql for table in ("attachments", "assignments", "ticket_events", "comments"))
    assert all(error == observed[0] for error in observed)


def test_anonymous_expired_and_disabled_sessions_are_rejected_by_real_auth(
    detail_app, read_data, read_contract_registry,
):
    path = f"/api/tickets/{read_data.ids[0]}"
    with TestClient(detail_app) as client:
        assert_error(client.get(path), 401, "UNAUTHORIZED", read_contract_registry)
        client.cookies.set(SESSION_COOKIE_NAME, "not-a-real-session")
        assert_error(client.get(path), 401, "UNAUTHORIZED", read_contract_registry)
    with client_for(
        detail_app, read_data, "REPORTER", expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    ) as client:
        assert_error(client.get(path), 401, "UNAUTHORIZED", read_contract_registry)
    with client_for(detail_app, read_data, "REPORTER") as client:
        assert client.get(path).status_code == 200
        with Session(read_data.engine) as db, db.begin():
            db.execute(update(User).where(User.id == read_data.users["REPORTER"].id).values(active=False))
        assert_error(client.get(path), 401, "UNAUTHORIZED", read_contract_registry)


def test_internal_timeline_is_filtered_in_sql_before_public_http_response(
    detail_app, read_data, read_contract_registry,
):
    for role in ("REPORTER", "TECHNICIAN", "ADMIN"):
        with client_for(detail_app, read_data, role) as client, capture_sql(read_data.engine) as queries:
            response = client.get(f"/api/tickets/{read_data.ids[2]}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert_component(payload, "TicketDetail", read_contract_registry)
        assert all(entry["ticket_id"] == read_data.ids[2] for entry in payload["timeline"])
        if role == "ADMIN":
            assert {entry["visibility"] for entry in payload["timeline"]} == {"PUBLIC", "ADMIN_ONLY"}
        else:
            assert all(entry["visibility"] == "PUBLIC" for entry in payload["timeline"])
            assert "private comment" not in response.text and "private event" not in response.text
            for table in ("ticket_events", "comments"):
                selected = [(sql, params) for sql, params in queries if f"from {table}" in sql.lower()]
                assert selected
                assert all("visibility" in sql.lower() and "PUBLIC" in repr(params) for sql, params in selected)


def test_timeline_uses_actual_time_with_fractional_seconds_and_stable_ties(detail_app, read_data):
    with Session(read_data.engine) as db, db.begin():
        db.add(Comment(
            ticket_id=read_data.ids[2], author_id=read_data.users["REPORTER"].id,
            body="Later within same second", visibility="PUBLIC",
            created_at=STAMP + timedelta(microseconds=100000),
        ))
    with client_for(detail_app, read_data, "REPORTER") as client:
        response = client.get(f"/api/tickets/{read_data.ids[2]}")
    assert response.status_code == 200, response.text
    rows = response.json()["timeline"]
    keys = [(datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")), row["kind"], row["id"]) for row in rows]
    assert keys == sorted(keys)
    assert rows[-1]["body"] == "Later within same second"


def test_terminal_detail_keeps_current_technician_and_has_no_actions(
    detail_app, read_data, read_contract_registry,
):
    for role in ("REPORTER", "TECHNICIAN", "ADMIN"):
        with client_for(detail_app, read_data, role) as client:
            response = client.get(f"/api/tickets/{read_data.ids[4]}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert_component(payload, "TicketDetail", read_contract_registry)
        assert payload["status"] == "CLOSED" and payload["closed_at"] is not None
        assert payload["current_assignee"]["id"] == read_data.users["TECHNICIAN"].id
        assert payload["current_responsible_role"] is None and payload["next_action"] is None
        assert payload["allowed_actions"] == []


def test_detail_keeps_saved_snapshot_after_location_is_renamed_and_disabled(detail_app, read_data):
    with Session(read_data.engine) as db, db.begin():
        db.execute(update(Location).where(Location.id == read_data.locations[0].id).values(
            building="Renamed building", floor="99", room_or_area="new room", active=False,
        ))
    with client_for(detail_app, read_data, "REPORTER") as client:
        response = client.get(f"/api/tickets/{read_data.ids[0]}")
    assert response.status_code == 200, response.text
    assert response.json()["location_label_snapshot"] == "Historical 0 / 9 / old"


def test_invalid_ticket_path_is_422_without_creating_a_new_error_semantic(
    detail_app, read_data, read_contract_registry,
):
    with client_for(detail_app, read_data, "ADMIN") as client:
        for ticket_id in ("not-an-integer", "0", "-1", "1.5", str(2**63)):
            assert_error(client.get(f"/api/tickets/{ticket_id}"), 422, "VALIDATION_ERROR", read_contract_registry)


def test_existing_cancel_action_is_reflected_in_fresh_detail_and_only_one_event(
    detail_app, read_data, read_contract_registry,
):
    path = f"/api/tickets/{read_data.ids[0]}"
    with client_for(detail_app, read_data, "REPORTER") as client:
        before = client.get(path)
        assert before.status_code == 200 and "CANCEL" in before.json()["allowed_actions"]
        cancelled = client.post(path + "/cancel", json={"expected_version": 1}, headers={"Origin": ORIGIN})
        assert cancelled.status_code == 200, cancelled.text
        assert_component(cancelled.json(), "TicketSummary", read_contract_registry)
        detail = client.get(path)
        assert detail.status_code == 200, detail.text
        payload = detail.json()
        assert_component(payload, "TicketDetail", read_contract_registry)
        assert (payload["status"], payload["version"], payload["allowed_actions"]) == ("CANCELLED", 2, [])
        assert len(payload["timeline"]) == 1
        event = payload["timeline"][0]
        assert (event["type"], event["from_status"], event["to_status"], event["note"]) == (
            "TICKET_CANCELLED", "SUBMITTED", "CANCELLED", None,
        )
        duplicate = client.post(path + "/cancel", json={"expected_version": 1}, headers={"Origin": ORIGIN})
        assert_error(duplicate, 409, "TICKET_VERSION_CONFLICT", read_contract_registry)
        assert client.get(path).json()["timeline"] == payload["timeline"]
    with Session(read_data.engine) as db:
        assert len(db.scalars(select(TicketEvent).where(TicketEvent.ticket_id == read_data.ids[0])).all()) == 1


def test_http_response_uses_fresh_columns_even_with_cached_orm_rows(detail_app, read_data):
    with client_for(detail_app, read_data, "ADMIN") as client, Session(read_data.engine) as stale:
        cached_ticket = stale.get(Ticket, read_data.ids[2])
        cached_reporter = stale.get(User, read_data.users["REPORTER"].id)
        cached_assignee = stale.get(User, read_data.users["TECHNICIAN"].id)
        with Session(read_data.engine) as writer, writer.begin():
            writer.execute(update(Ticket).where(Ticket.id == cached_ticket.id).values(title="Fresh HTTP title"))
            writer.execute(update(User).where(User.id == cached_reporter.id).values(name="Fresh HTTP reporter"))
            writer.execute(update(User).where(User.id == cached_assignee.id).values(name="Fresh HTTP technician"))

        def stale_db():
            yield stale

        detail_app.dependency_overrides[get_db] = stale_db
        response = client.get(f"/api/tickets/{read_data.ids[2]}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["title"] == "Fresh HTTP title"
        assert payload["reporter"]["name"] == "Fresh HTTP reporter"
        assert payload["current_assignee"]["name"] == "Fresh HTTP technician"
        assert cached_ticket.title == "Fixture title 2"
        assert cached_reporter.name != "Fresh HTTP reporter"
        assert cached_assignee.name != "Fresh HTTP technician"
