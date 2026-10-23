"""#54 real authenticated comments, shared detail privacy and handoff closure."""

import importlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from time import monotonic
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Attachment, Comment, Session as AuthSession, Ticket, TicketEvent, User
from test_ticket_creation_api import creation_app, fields, submit  # noqa: F401
from test_workflow_api import (  # noqa: F401
    HEADERS, assigned_ticket, assert_schema, contract_registry, login, pg_engine,
    png_bytes, ticket_fixture,
)


def comment(client, ticket_id, *, body="公开留言", visibility="PUBLIC", headers=HEADERS):
    return client.post(f"/api/tickets/{ticket_id}/comments",
                       json={"body": body, "visibility": visibility}, headers=headers)


def assert_error(response, status, code, registry):
    assert response.status_code == status, response.text
    assert_schema(response, "ErrorResponse", registry)
    assert response.json()["error"]["code"] == code


@pytest.mark.parametrize(("role", "visibility"), [
    ("REPORTER", "PUBLIC"), ("TECHNICIAN", "PUBLIC"), ("ADMIN", "PUBLIC"), ("ADMIN", "ADMIN_ONLY"),
])
def test_allowed_comment_is_a_contract_row_without_state_version_or_event_change(
    creation_app, contract_registry, role, visibility,
):
    data = creation_app
    ticket_id = assigned_ticket(data.engine)
    with Session(data.engine) as db:
        before = db.get(Ticket, ticket_id).updated_at
    response = comment(login(data.app, role), ticket_id, visibility=visibility)
    assert response.status_code == 201, response.text
    assert_schema(response, "Comment", contract_registry)
    payload = response.json()
    assert payload["kind"] == "COMMENT" and payload["ticket_id"] == ticket_id
    assert payload["author"]["role"] == role and payload["visibility"] == visibility
    assert payload["created_at"].endswith("Z")
    assert set(payload["author"]) == {"id", "name", "role"}
    with Session(data.engine) as db:
        ticket = db.get(Ticket, ticket_id)
        assert (ticket.status, ticket.version, ticket.updated_at) == ("ASSIGNED", 3, before)
        assert db.scalar(select(func.count()).select_from(Comment)) == 1
        assert db.scalar(select(func.count()).select_from(TicketEvent)) == 0


@pytest.mark.parametrize("role", ["REPORTER", "TECHNICIAN"])
def test_non_admin_internal_note_is_denied_and_never_written(creation_app, contract_registry, role):
    data = creation_app
    ticket_id = assigned_ticket(data.engine)
    assert_error(comment(login(data.app, role), ticket_id, visibility="ADMIN_ONLY"), 403, "FORBIDDEN", contract_registry)
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Comment)) == 0


@pytest.mark.parametrize("payload", [
    {}, {"body": "a"}, {"visibility": "PUBLIC"}, {"body": "", "visibility": "PUBLIC"},
    {"body": "x" * 2001, "visibility": "PUBLIC"}, {"body": 123, "visibility": "PUBLIC"},
    {"body": None, "visibility": "PUBLIC"}, {"body": "a", "visibility": "PRIVATE"},
    {"body": "a", "visibility": "PUBLIC", "author_id": 3},
    {"body": "a", "visibility": "PUBLIC", "expected_version": 3},
])
def test_invalid_body_visibility_and_extra_fields_are_rejected(creation_app, contract_registry, payload):
    data = creation_app
    ticket_id = assigned_ticket(data.engine)
    response = login(data.app, "REPORTER").post(f"/api/tickets/{ticket_id}/comments", json=payload, headers=HEADERS)
    assert_error(response, 422, "VALIDATION_ERROR", contract_registry)
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Comment)) == 0


@pytest.mark.parametrize("body", ["字", "字" * 2000, " "])
def test_exact_character_boundaries_preserve_input_without_new_whitespace_rules(creation_app, body):
    data = creation_app
    ticket_id = ticket_fixture(data.engine)
    response = comment(login(data.app, "REPORTER"), ticket_id, body=body)
    assert response.status_code == 201 and response.json()["body"] == body


def test_unrelated_missing_and_unauthenticated_comments(creation_app, contract_registry):
    data = creation_app
    ticket_id = ticket_fixture(data.engine)  # Technician has not been assigned.
    technician = login(data.app, "TECHNICIAN")
    denied = comment(technician, ticket_id)
    missing = comment(technician, 9223372036854775807)
    for response in [denied, missing]:
        assert_error(response, 404, "NOT_FOUND", contract_registry)
    def public_error(response):
        return {k: v for k, v in response.json()["error"].items() if k != "request_id"}
    assert public_error(denied) == public_error(missing)
    assert_error(comment(TestClient(data.app), ticket_id), 401, "UNAUTHORIZED", contract_registry)


def test_origin_disabled_and_expired_sessions_are_checked(creation_app, contract_registry):
    data = creation_app
    ticket_id = ticket_fixture(data.engine)
    client = login(data.app, "REPORTER")
    for headers in [{}, {"Origin": "https://untrusted.example.invalid"}]:
        assert_error(comment(client, ticket_id, headers=headers), 403, "ORIGIN_NOT_ALLOWED", contract_registry)
    with Session(data.engine) as db, db.begin():
        db.get(User, 1).active = False
    assert_error(comment(client, ticket_id), 401, "UNAUTHORIZED", contract_registry)
    with Session(data.engine) as db, db.begin():
        db.get(User, 1).active = True
        db.execute(update(AuthSession).values(expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc)))
    assert_error(comment(client, ticket_id), 401, "UNAUTHORIZED", contract_registry)
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Comment)) == 0


@pytest.mark.parametrize("terminal", ["CANCELLED", "REJECTED", "CLOSED"])
def test_terminal_comments_stay_readable_but_no_role_can_append(creation_app, contract_registry, terminal):
    data = creation_app
    ticket_id = assigned_ticket(data.engine, "PENDING_CONFIRMATION", 5)
    reporter, admin, technician = [login(data.app, role) for role in ["REPORTER", "ADMIN", "TECHNICIAN"]]
    public = comment(reporter, ticket_id).json()
    internal = comment(admin, ticket_id, body="ADMIN-ONLY-SENTINEL", visibility="ADMIN_ONLY").json()
    with Session(data.engine) as db, db.begin():
        ticket = db.get(Ticket, ticket_id)
        if terminal == "CLOSED":
            ticket.closed_at = datetime.now(timezone.utc)
        else:
            ticket.current_assignee_id = None
        ticket.status = terminal
    for client in [reporter, admin]:
        assert_error(comment(client, ticket_id), 409, "CONFLICT", contract_registry)
        detail = client.get(f"/api/tickets/{ticket_id}")
        assert detail.status_code == 200
        assert_schema(detail, "TicketDetail", contract_registry)
        ids = {row["id"] for row in detail.json()["timeline"] if row["kind"] == "COMMENT"}
        assert public["id"] in ids
        assert (internal["id"] in ids) is (client is admin)
    if terminal == "CLOSED":
        assert_error(comment(technician, ticket_id), 409, "CONFLICT", contract_registry)
        assert "ADMIN-ONLY-SENTINEL" not in technician.get(f"/api/tickets/{ticket_id}").text
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Comment)) == 2


@pytest.mark.parametrize("failure", ["insert", "commit"])
def test_failed_comment_is_not_persisted(creation_app, contract_registry, monkeypatch, failure):
    data = creation_app
    ticket_id = ticket_fixture(data.engine)
    authenticated = login(data.app, "REPORTER")
    if failure == "insert":
        with Session(data.engine) as db, db.begin():
            db.execute(text("""CREATE FUNCTION reject_comment() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'private fixture failure'; END; $$"""))
            db.execute(text("CREATE TRIGGER reject_comment BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION reject_comment()"))
    else:
        def failing_db():
            with Session(data.engine) as db:
                def fail():
                    raise RuntimeError("private fixture commit failure")
                monkeypatch.setattr(db, "commit", fail)
                yield db
        data.app.dependency_overrides[get_db] = failing_db
    with TestClient(data.app, cookies=dict(authenticated.cookies), raise_server_exceptions=False) as client:
        response = comment(client, ticket_id)
    assert_error(response, 500, "INTERNAL_ERROR", contract_registry)
    assert "private" not in response.text
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Comment)) == 0
        ticket = db.get(Ticket, ticket_id)
        assert (ticket.status, ticket.version) == ("SUBMITTED", 1)


def test_a_terminal_transition_winning_the_row_lock_prevents_new_comments(creation_app):
    data = creation_app
    ticket_id = ticket_fixture(data.engine)
    client = login(data.app, "REPORTER")
    with Session(data.engine) as closer:
        closer.execute(update(Ticket).where(Ticket.id == ticket_id).values(status="CANCELLED", version=2))
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(comment, client, ticket_id)
            try:
                deadline = monotonic() + 10
                waiting = False
                while monotonic() < deadline:
                    with data.engine.connect() as connection:
                        waiting = bool(connection.scalar(text("""SELECT count(*) FROM pg_stat_activity
                            WHERE datname=current_database() AND wait_event_type='Lock'
                            AND query ILIKE '%FOR UPDATE%'""")))
                    if waiting:
                        break
                    Event().wait(0.01)
                assert waiting, "comment must serialize its state check with terminal writes"
            finally:
                closer.commit()
            response = pending.result(timeout=10)
    assert response.status_code == 409
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Comment)) == 0


def test_actual_report_photo_comments_resolution_photo_and_closed_history_handoff(creation_app, contract_registry):
    data = creation_app
    reporter, admin, technician = [login(data.app, role) for role in ["REPORTER", "ADMIN", "TECHNICIAN"]]
    created = submit(reporter, fields(data), [("report.png", png_bytes(), "image/png")])
    assert created.status_code == 201
    ticket_id = created.json()["id"]
    url = f"/api/tickets/{ticket_id}"
    report_photo = reporter.get(url).json()["report_photos"][0]
    assert reporter.get(report_photo["download_url"]).content == png_bytes()
    assert technician.get(report_photo["download_url"]).status_code == 404
    assert comment(reporter, ticket_id, body="REPORTER-PUBLIC").status_code == 201
    internal = comment(admin, ticket_id, body="ONLY-ADMIN-SECRET", visibility="ADMIN_ONLY")
    assert internal.status_code == 201
    assert_error(comment(reporter, ticket_id, visibility="ADMIN_ONLY"), 403, "FORBIDDEN", contract_registry)
    approved = admin.post(url + "/review", headers=HEADERS, json={
        "decision": "APPROVE", "category": "LIGHTING_ELECTRICAL", "priority": "HIGH", "expected_version": 1,
    })
    assert approved.status_code == 200
    assigned = admin.post(url + "/assign", headers=HEADERS, json={"technician_id": 2, "expected_version": 2})
    assert assigned.status_code == 200
    assert technician.post(url + "/start", headers=HEADERS, json={"expected_version": 3}).status_code == 200
    assert comment(technician, ticket_id, body="TECHNICIAN-PUBLIC").status_code == 201
    assert_error(comment(technician, ticket_id, visibility="ADMIN_ONLY"), 403, "FORBIDDEN", contract_registry)
    resolved = technician.post(url + "/resolve", headers=HEADERS,
                               data={"resolution_note": "已修复", "expected_version": "4"},
                               files=[("photos", ("result.png", png_bytes(), "image/png"))])
    assert resolved.status_code == 200 and resolved.json()["version"] == 5
    for client in [reporter, technician, admin]:
        detail = client.get(url)
        assert_schema(detail, "TicketDetail", contract_registry)
        assert ("ONLY-ADMIN-SECRET" in detail.text) is (client is admin)
        for photo in detail.json()["report_photos"] + detail.json()["resolution_photos"]:
            downloaded = client.get(photo["download_url"])
            assert downloaded.status_code == 200 and downloaded.content == png_bytes()
    closed = reporter.post(url + "/confirm", headers=HEADERS, json={"expected_version": 5})
    assert closed.status_code == 200 and closed.json()["version"] == 6
    for client in [reporter, technician, admin]:
        detail = client.get(url)
        assert detail.status_code == 200 and detail.json()["status"] == "CLOSED"
        assert_error(comment(client, ticket_id), 409, "CONFLICT", contract_registry)
        assert len([row for row in detail.json()["timeline"] if row["kind"] == "COMMENT"]) == (3 if client is admin else 2)
        for photo in detail.json()["report_photos"] + detail.json()["resolution_photos"]:
            assert client.get(photo["download_url"]).status_code == 200
    with Session(data.engine) as db:
        assert db.get(Ticket, ticket_id).version == 6
        assert db.scalar(select(func.count()).select_from(Comment)) == 3
        assert db.scalar(select(func.count()).select_from(TicketEvent)) == 6
        assert db.scalar(select(func.count()).select_from(Attachment)) == 2
