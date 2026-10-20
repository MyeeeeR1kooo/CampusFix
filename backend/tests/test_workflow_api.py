"""Issue #50 workflow actions against disposable PostgreSQL."""

import importlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
import yaml
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from PIL import Image
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.main import create_app
from app.models import Assignment, Attachment, Comment, Location, Session as AuthSession, Ticket, TicketEvent, User
from app.seed import SeedPasswords, seed_demo_data
from app.modules.workflow.rules import TRANSITIONS
from app.modules.workflow.service import visible_timeline


ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}
PASSWORDS = {"REPORTER": "fixture-reporter", "TECHNICIAN": "fixture-technician", "ADMIN": "fixture-admin"}
BACKEND = Path(__file__).resolve().parents[1]
CONTRACT_URI = "urn:campusfix:workflow-tests"


@pytest.fixture(scope="module")
def contract_registry():
    contract = yaml.safe_load((BACKEND.parent / "docs/api/openapi.yaml").read_text(encoding="utf-8"))
    return Registry().with_resource(
        CONTRACT_URI, Resource.from_contents(contract, default_specification=DRAFT202012),
    )


@pytest.fixture
def pg_engine():
    url = os.environ.get("CAMPUSFIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("CAMPUSFIX_TEST_DATABASE_URL is required for PostgreSQL workflow tests")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    if admin.dialect.name != "postgresql":
        raise ValueError("Workflow integration tests require PostgreSQL")
    database = "campusfix_workflow_test_" + uuid4().hex
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database}"'))
    engine = create_engine(make_url(url).set(database=database))
    try:
        with engine.connect() as connection:
            config = Config(str(BACKEND / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        passwords = SeedPasswords(
            _env_file=None,
            reporter_password=PASSWORDS["REPORTER"],
            technician_password=PASSWORDS["TECHNICIAN"],
            admin_password=PASSWORDS["ADMIN"],
        )
        with Session(engine) as db, db.begin():
            seed_demo_data(db, passwords)
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{database}"'))
        admin.dispose()


@pytest.fixture
def app(pg_engine, monkeypatch):
    settings = Settings(
        _env_file=None, secret_key="workflow-test-secret-" + "x" * 32,
        allowed_origins=[ORIGIN], environment="test",
    )
    main_module = importlib.import_module("app.main")
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    application = create_app()
    application.dependency_overrides[get_settings] = lambda: settings

    def test_db():
        with Session(pg_engine) as db:
            yield db

    application.dependency_overrides[get_db] = test_db
    return application


def login(app, role):
    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        json={"email": role.lower() + "@example.invalid", "password": PASSWORDS[role]},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return client


def create_ticket(db, reporter, status="SUBMITTED", version=1, priority=None, assignee_id=None):
    location = db.scalar(select(Location).order_by(Location.id))
    row = Ticket(
        code=f"CF-20261020-{uuid4().int % 1_000_000:06d}",
        reporter_id=reporter.id, location_id=location.id,
        location_label_snapshot=f"{location.building} / {location.floor} / {location.room_or_area}",
        title="Workflow test ticket", description="Disposable integration fixture",
        category="LIGHTING_ELECTRICAL", priority=priority,
        status=status, version=version, current_assignee_id=assignee_id,
    )
    db.add(row)
    db.flush()
    return row.id


def ticket_fixture(engine, status="SUBMITTED", version=1, priority=None, assignee_id=None):
    with Session(engine) as db, db.begin():
        reporter = db.scalar(select(User).where(User.role == "REPORTER"))
        return create_ticket(db, reporter, status, version, priority, assignee_id)


def assigned_ticket(engine, status="ASSIGNED", version=3):
    return ticket_fixture(engine, status, version, "HIGH", assignee_id=2)


def png_bytes():
    image = Image.new("RGB", (2, 2), "red")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def assert_schema(response, schema, registry):
    Draft202012Validator(
        {"$ref": CONTRACT_URI + "#/components/schemas/" + schema},
        registry=registry, format_checker=FormatChecker(),
    ).validate(response.json())
    assert response.headers["x-request-id"].startswith("req_")
    if schema == "ErrorResponse":
        assert response.headers["x-request-id"] == response.json()["error"]["request_id"]


def assert_state(engine, ticket_id, status, version, event_count, assignment_count=0):
    with Session(engine) as db:
        ticket = db.get(Ticket, ticket_id)
        assert (ticket.status, ticket.version) == (status, version)
        assert db.scalar(select(func.count()).select_from(TicketEvent).where(TicketEvent.ticket_id == ticket_id)) == event_count
        assert db.scalar(select(func.count()).select_from(Assignment).where(Assignment.ticket_id == ticket_id)) == assignment_count


def test_rule_table_defines_only_the_eight_approved_transitions():
    assert len(TRANSITIONS) == 8
    assert {(rule.from_status, rule.to_status) for rule in TRANSITIONS.values()} == {
        ("SUBMITTED", "PENDING_ASSIGNMENT"), ("SUBMITTED", "REJECTED"),
        ("SUBMITTED", "CANCELLED"), ("PENDING_ASSIGNMENT", "ASSIGNED"),
        ("ASSIGNED", "IN_PROGRESS"), ("IN_PROGRESS", "PENDING_CONFIRMATION"),
        ("PENDING_CONFIRMATION", "CLOSED"), ("PENDING_CONFIRMATION", "IN_PROGRESS"),
    }


@pytest.mark.parametrize("decision,body,status,event_type", [
    ("APPROVE", {"decision": "APPROVE", "category": "HVAC", "priority": "HIGH", "expected_version": 1}, "PENDING_ASSIGNMENT", "TICKET_APPROVED"),
    ("REJECT", {"decision": "REJECT", "reason": "Outside scope", "expected_version": 1}, "REJECTED", "TICKET_REJECTED"),
])
def test_admin_review_actions_commit_state_version_and_one_public_event(
    app, pg_engine, contract_registry, decision, body, status, event_type,
):
    ticket_id = ticket_fixture(pg_engine)
    response = login(app, "ADMIN").post(f"/api/tickets/{ticket_id}/review", json=body, headers=HEADERS)
    assert response.status_code == 200, response.text
    assert_schema(response, "TicketSummary", contract_registry)
    assert response.json()["status"] == status and response.json()["version"] == 2
    assert_state(pg_engine, ticket_id, status, 2, 1)
    with Session(pg_engine) as db:
        event = db.scalar(select(TicketEvent).where(TicketEvent.ticket_id == ticket_id))
        assert (event.type, event.from_status, event.to_status, event.visibility) == (
            event_type, "SUBMITTED", status, "PUBLIC",
        )
        assert event.actor_id == db.scalar(select(User.id).where(User.role == "ADMIN"))


def test_original_reporter_can_cancel_with_optional_reason_only_once(app, pg_engine, contract_registry):
    ticket_id = ticket_fixture(pg_engine)
    reporter = login(app, "REPORTER")
    response = reporter.post(
        f"/api/tickets/{ticket_id}/cancel", json={"expected_version": 1, "reason": "No longer needed"}, headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    assert_schema(response, "TicketSummary", contract_registry)
    assert response.json()["status"] == "CANCELLED"
    duplicate = reporter.post(f"/api/tickets/{ticket_id}/cancel", json={"expected_version": 1}, headers=HEADERS)
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "TICKET_VERSION_CONFLICT"
    assert_state(pg_engine, ticket_id, "CANCELLED", 2, 1)


def test_assign_writes_assignee_assignment_and_event_atomically(app, pg_engine, contract_registry):
    ticket_id = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "MEDIUM")
    response = login(app, "ADMIN").post(
        f"/api/tickets/{ticket_id}/assign", json={"technician_id": 2, "expected_version": 2}, headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    assert_schema(response, "TicketSummary", contract_registry)
    assert response.json()["status"] == "ASSIGNED" and response.json()["version"] == 3
    assert response.json()["current_assignee"]["id"] == 2
    assert_state(pg_engine, ticket_id, "ASSIGNED", 3, 1, 1)
    with Session(pg_engine) as db:
        assignment = db.scalar(select(Assignment).where(Assignment.ticket_id == ticket_id))
        event = db.scalar(select(TicketEvent).where(TicketEvent.ticket_id == ticket_id))
        assert assignment.technician_id == 2 and assignment.assigned_by == event.actor_id
        assert assignment.ended_at is None
        assert (event.type, event.from_status, event.to_status) == (
            "TICKET_ASSIGNED", "PENDING_ASSIGNMENT", "ASSIGNED",
        )


@pytest.mark.parametrize(("role", "expected_status"), [("REPORTER", 403), ("TECHNICIAN", 404)])
def test_only_admin_can_review_or_assign(app, pg_engine, role, expected_status):
    ticket_id = ticket_fixture(pg_engine)
    body = {"decision": "REJECT", "reason": "Outside scope", "expected_version": 1}
    response = login(app, role).post(f"/api/tickets/{ticket_id}/review", json=body, headers=HEADERS)
    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == ("FORBIDDEN" if expected_status == 403 else "NOT_FOUND")
    assert_state(pg_engine, ticket_id, "SUBMITTED", 1, 0)


def test_non_owner_reporter_cannot_cancel_another_reporters_ticket(app, pg_engine):
    with Session(pg_engine) as db, db.begin():
        reporter = db.scalar(select(User).where(User.role == "REPORTER"))
        second = User(name="Other Reporter", email="other-reporter@example.invalid", password_hash="unused", role="REPORTER")
        db.add(second)
        db.flush()
        ticket_id = create_ticket(db, reporter)
        db.add(AuthSession(
            user_id=second.id, token_hash=hash_session_token("second-reporter-session"),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        ))
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE_NAME, "second-reporter-session")
    response = client.post(f"/api/tickets/{ticket_id}/cancel", json={"expected_version": 1}, headers=HEADERS)
    assert response.status_code == 404 and response.json()["error"]["code"] == "NOT_FOUND"
    assert_state(pg_engine, ticket_id, "SUBMITTED", 1, 0)


@pytest.mark.parametrize(("technician", "disable"), [(999, False), (1, False), (3, False), (2, True)])
def test_invalid_assignment_target_is_422_without_side_effects(app, pg_engine, technician, disable):
    ticket_id = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH")
    if disable:
        with Session(pg_engine) as db, db.begin():
            target = db.get(User, technician)
            target.active = False
    response = login(app, "ADMIN").post(
        f"/api/tickets/{ticket_id}/assign",
        json={"technician_id": technician, "expected_version": 2}, headers=HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["field_errors"][0]["field"] == "technician_id"
    assert_state(pg_engine, ticket_id, "PENDING_ASSIGNMENT", 2, 0)


def test_illegal_transition_and_old_version_have_deterministic_conflicts(app, pg_engine):
    ticket_id = ticket_fixture(pg_engine)
    admin = login(app, "ADMIN")
    illegal = admin.post(
        f"/api/tickets/{ticket_id}/assign", json={"technician_id": 2, "expected_version": 1}, headers=HEADERS,
    )
    assert illegal.status_code == 409 and illegal.json()["error"]["code"] == "CONFLICT"
    review = admin.post(
        f"/api/tickets/{ticket_id}/review",
        json={"decision": "REJECT", "reason": "Outside scope", "expected_version": 1}, headers=HEADERS,
    )
    assert review.status_code == 200
    stale = admin.post(
        f"/api/tickets/{ticket_id}/review",
        json={"decision": "REJECT", "reason": "Outside scope", "expected_version": 1}, headers=HEADERS,
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "TICKET_VERSION_CONFLICT"
    assert_state(pg_engine, ticket_id, "REJECTED", 2, 1)


def test_concurrent_review_requests_have_one_winner(app, pg_engine):
    ticket_id = ticket_fixture(pg_engine)
    barrier = Barrier(2)

    def submit(decision):
        client = login(app, "ADMIN")
        barrier.wait(timeout=5)
        payload = (
            {"decision": "REJECT", "reason": "Outside scope", "expected_version": 1}
            if decision == "REJECT" else
            {"decision": "APPROVE", "category": "HVAC", "priority": "HIGH", "expected_version": 1}
        )
        return client.post(f"/api/tickets/{ticket_id}/review", json=payload, headers=HEADERS)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, ("REJECT", "APPROVE")))
    assert sorted(response.status_code for response in results) == [200, 409]
    winner = next(response for response in results if response.status_code == 200)
    assert_state(pg_engine, ticket_id, winner.json()["status"], 2, 1)


def test_event_insert_failure_rolls_back_state_and_assignment(app, pg_engine):
    ticket_id = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH")
    with Session(pg_engine) as db, db.begin():
        db.execute(text("""
            CREATE FUNCTION reject_workflow_event() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test event insert failure'; END;
            $$
        """))
        db.execute(text("""
            CREATE TRIGGER reject_workflow_event BEFORE INSERT ON ticket_events
            FOR EACH ROW EXECUTE FUNCTION reject_workflow_event()
        """))
    client = TestClient(app, raise_server_exceptions=False)
    login_response = client.post(
        "/api/auth/login",
        json={"email": "admin@example.invalid", "password": PASSWORDS["ADMIN"]},
        headers=HEADERS,
    )
    assert login_response.status_code == 200
    response = client.post(
        f"/api/tickets/{ticket_id}/assign", json={"technician_id": 2, "expected_version": 2}, headers=HEADERS,
    )
    assert response.status_code == 500 and response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert_state(pg_engine, ticket_id, "PENDING_ASSIGNMENT", 2, 0, 0)
    with Session(pg_engine) as db, db.begin():
        db.execute(text("DROP TRIGGER reject_workflow_event ON ticket_events"))
        db.execute(text("DROP FUNCTION reject_workflow_event()"))


def test_technician_start_and_resolve_then_reporter_confirm(app, pg_engine, contract_registry):
    ticket_id = assigned_ticket(pg_engine)
    technician = login(app, "TECHNICIAN")
    reporter = login(app, "REPORTER")
    started = technician.post(
        f"/api/tickets/{ticket_id}/start", json={"expected_version": 3, "note": "On site"}, headers=HEADERS,
    )
    assert started.status_code == 200, started.text
    assert_schema(started, "TicketSummary", contract_registry)
    assert started.json()["status"] == "IN_PROGRESS" and started.json()["version"] == 4
    resolved = technician.post(
        f"/api/tickets/{ticket_id}/resolve",
        data={"resolution_note": "Replaced the lamp", "expected_version": "4"}, headers=HEADERS,
    )
    assert resolved.status_code == 200, resolved.text
    assert_schema(resolved, "TicketSummary", contract_registry)
    assert resolved.json()["status"] == "PENDING_CONFIRMATION"
    confirmed = reporter.post(
        f"/api/tickets/{ticket_id}/confirm", json={"expected_version": 5}, headers=HEADERS,
    )
    assert confirmed.status_code == 200, confirmed.text
    assert_schema(confirmed, "TicketSummary", contract_registry)
    assert confirmed.json()["status"] == "CLOSED" and confirmed.json()["version"] == 6
    assert confirmed.json()["closed_at"] is not None
    assert_state(pg_engine, ticket_id, "CLOSED", 6, 3)
    with Session(pg_engine) as db:
        events = db.scalars(select(TicketEvent).where(TicketEvent.ticket_id == ticket_id).order_by(TicketEvent.id)).all()
        assert [event.type for event in events] == ["WORK_STARTED", "RESOLUTION_SUBMITTED", "TICKET_CLOSED"]
        assert [event.note for event in events] == ["On site", "Replaced the lamp", None]
        assert db.get(Ticket, ticket_id).current_assignee_id == 2


def test_reporter_rework_preserves_assignee_and_can_resolve_again(app, pg_engine):
    ticket_id = assigned_ticket(pg_engine, "PENDING_CONFIRMATION", 5)
    reporter = login(app, "REPORTER")
    technician = login(app, "TECHNICIAN")
    reworked = reporter.post(
        f"/api/tickets/{ticket_id}/rework", json={"expected_version": 5, "reason": "Still broken"}, headers=HEADERS,
    )
    assert reworked.status_code == 200, reworked.text
    assert reworked.json()["status"] == "IN_PROGRESS"
    assert reworked.json()["current_assignee"]["id"] == 2
    repeated = technician.post(
        f"/api/tickets/{ticket_id}/resolve",
        data={"resolution_note": "Checked again", "expected_version": "6"}, headers=HEADERS,
    )
    assert repeated.status_code == 200, repeated.text
    assert_state(pg_engine, ticket_id, "PENDING_CONFIRMATION", 7, 2)


@pytest.mark.parametrize("role,path,body,initial_status,version", [
    ("REPORTER", "start", {"expected_version": 3}, "ASSIGNED", 3),
    ("ADMIN", "start", {"expected_version": 3}, "ASSIGNED", 3),
    ("REPORTER", "confirm", {"expected_version": 3}, "ASSIGNED", 3),
    ("TECHNICIAN", "confirm", {"expected_version": 5}, "PENDING_CONFIRMATION", 5),
    ("TECHNICIAN", "rework", {"expected_version": 5, "reason": "Still broken"}, "PENDING_CONFIRMATION", 5),
])
def test_second_phase_actions_reject_wrong_role_or_state(app, pg_engine, role, path, body, initial_status, version):
    ticket_id = assigned_ticket(pg_engine, initial_status, version)
    response = login(app, role).post(f"/api/tickets/{ticket_id}/{path}", json=body, headers=HEADERS)
    assert response.status_code in {403, 409}
    assert_state(pg_engine, ticket_id, initial_status, version, 0)


@pytest.mark.parametrize("path,body", [
    ("rework", {"expected_version": 5, "reason": ""}),
    ("rework", {"expected_version": 5}),
    ("confirm", {"expected_version": 5, "rating": 5}),
])
def test_rework_reason_and_confirm_contract_reject_invalid_input(app, pg_engine, path, body):
    ticket_id = assigned_ticket(pg_engine, "PENDING_CONFIRMATION", 5)
    response = login(app, "REPORTER").post(f"/api/tickets/{ticket_id}/{path}", json=body, headers=HEADERS)
    assert response.status_code == 422
    assert_state(pg_engine, ticket_id, "PENDING_CONFIRMATION", 5, 0)


def test_resolution_photo_is_private_metadata_and_file(app, pg_engine, tmp_path):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, allowed_origins=[ORIGIN], environment="test",
        attachment_storage_path=tmp_path,
    )
    ticket_id = assigned_ticket(pg_engine, "IN_PROGRESS", 4)
    response = login(app, "TECHNICIAN").post(
        f"/api/tickets/{ticket_id}/resolve",
        data={"resolution_note": "Replaced lamp", "expected_version": "4"},
        files=[("photos", ("result.png", png_bytes(), "image/png"))], headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    with Session(pg_engine) as db:
        photo = db.scalar(select(Attachment).where(Attachment.ticket_id == ticket_id))
        assert photo.purpose == "RESOLUTION_PHOTO" and photo.mime == "image/png"
        assert photo.original_name == "result.png" and photo.size == len(png_bytes())
        assert (tmp_path / photo.storage_key).read_bytes() == png_bytes()
    assert_state(pg_engine, ticket_id, "PENDING_CONFIRMATION", 5, 1)


@pytest.mark.parametrize("files,expected_status", [
    ([("photos", ("fake.png", b"not an image", "image/png"))], 422),
    ([("photos", ("fake.svg", b"<svg></svg>", "image/svg+xml"))], 415),
    ([("photos", ("mismatch.png", png_bytes(), "image/jpeg"))], 415),
    ([("photos", ("large.png", b"a" * (5 * 1024 * 1024 + 1), "image/png"))], 413),
])
def test_invalid_result_photo_leaves_no_file_or_state_change(app, pg_engine, tmp_path, files, expected_status):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, allowed_origins=[ORIGIN], environment="test",
        attachment_storage_path=tmp_path,
    )
    ticket_id = assigned_ticket(pg_engine, "IN_PROGRESS", 4)
    response = login(app, "TECHNICIAN").post(
        f"/api/tickets/{ticket_id}/resolve",
        data={"resolution_note": "Replaced lamp", "expected_version": "4"},
        files=files, headers=HEADERS,
    )
    assert response.status_code == expected_status, response.text
    assert_state(pg_engine, ticket_id, "IN_PROGRESS", 4, 0)
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Attachment).where(Attachment.ticket_id == ticket_id)) == 0
    assert list(tmp_path.iterdir()) == []


def test_timeline_filters_internal_rows_and_sorts_stably(pg_engine, contract_registry):
    ticket_id = assigned_ticket(pg_engine, "IN_PROGRESS", 4)
    with Session(pg_engine) as db, db.begin():
        reporter = db.scalar(select(User).where(User.role == "REPORTER"))
        admin = db.scalar(select(User).where(User.role == "ADMIN"))
        db.add_all([
            TicketEvent(ticket_id=ticket_id, actor_id=admin.id, type="WORK_STARTED", from_status="ASSIGNED", to_status="IN_PROGRESS", visibility="PUBLIC"),
            TicketEvent(ticket_id=ticket_id, actor_id=admin.id, type="WORK_STARTED", from_status="ASSIGNED", to_status="IN_PROGRESS", visibility="ADMIN_ONLY"),
            Comment(ticket_id=ticket_id, author_id=admin.id, body="Internal note", visibility="ADMIN_ONLY"),
            Comment(ticket_id=ticket_id, author_id=reporter.id, body="Public note", visibility="PUBLIC"),
        ])
    with Session(pg_engine) as db:
        ticket = db.get(Ticket, ticket_id)
        reporter_rows = visible_timeline(db, ticket, db.scalar(select(User).where(User.role == "REPORTER")))
        admin_rows = visible_timeline(db, ticket, db.scalar(select(User).where(User.role == "ADMIN")))
        assert len(reporter_rows) == 2 and all(row["visibility"] == "PUBLIC" for row in reporter_rows)
        assert len(admin_rows) == 4
        assert [row["kind"] for row in admin_rows] == ["COMMENT", "COMMENT", "EVENT", "EVENT"]
        for row in admin_rows:
            schema = "TicketEvent" if row["kind"] == "EVENT" else "Comment"
            Draft202012Validator(
                {"$ref": CONTRACT_URI + "#/components/schemas/" + schema},
                registry=contract_registry, format_checker=FormatChecker(),
            ).validate(row)


@pytest.mark.parametrize("action,role,status,version,body", [
    ("start", "TECHNICIAN", "ASSIGNED", 3, {"expected_version": 3}),
    ("resolve", "TECHNICIAN", "IN_PROGRESS", 4, {"expected_version": "4", "resolution_note": "Fixed"}),
    ("confirm", "REPORTER", "PENDING_CONFIRMATION", 5, {"expected_version": 5}),
])
def test_concurrent_second_phase_actions_have_one_winner(
    app, pg_engine, action, role, status, version, body,
):
    ticket_id = assigned_ticket(pg_engine, status, version)
    workers = 8
    barrier = Barrier(workers)

    def submit(_):
        client = login(app, role)
        barrier.wait(timeout=15)
        if action == "resolve":
            return client.post(f"/api/tickets/{ticket_id}/{action}", data=body, headers=HEADERS)
        return client.post(f"/api/tickets/{ticket_id}/{action}", json=body, headers=HEADERS)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(submit, range(workers)))
    assert sorted(response.status_code for response in results) == [200] + [409] * (workers - 1)
    loser = next(response for response in results if response.status_code == 409)
    assert loser.json()["error"]["code"] == "TICKET_VERSION_CONFLICT"
    target = {"start": "IN_PROGRESS", "resolve": "PENDING_CONFIRMATION", "confirm": "CLOSED"}[action]
    assert_state(pg_engine, ticket_id, target, version + 1, 1)


def test_result_photo_and_state_roll_back_when_event_insert_fails(app, pg_engine, tmp_path):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, allowed_origins=[ORIGIN], environment="test",
        attachment_storage_path=tmp_path,
    )
    ticket_id = assigned_ticket(pg_engine, "IN_PROGRESS", 4)
    with Session(pg_engine) as db, db.begin():
        db.execute(text("""
            CREATE FUNCTION reject_result_event() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test result event failure'; END;
            $$
        """))
        db.execute(text("""
            CREATE TRIGGER reject_result_event BEFORE INSERT ON ticket_events
            FOR EACH ROW EXECUTE FUNCTION reject_result_event()
        """))
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post(
        "/api/auth/login",
        json={"email": "technician@example.invalid", "password": PASSWORDS["TECHNICIAN"]},
        headers=HEADERS,
    )
    assert response.status_code == 200
    response = client.post(
        f"/api/tickets/{ticket_id}/resolve",
        data={"resolution_note": "Replaced lamp", "expected_version": "4"},
        files=[("photos", ("result.png", png_bytes(), "image/png"))], headers=HEADERS,
    )
    assert response.status_code == 500 and response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert_state(pg_engine, ticket_id, "IN_PROGRESS", 4, 0)
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Attachment).where(Attachment.ticket_id == ticket_id)) == 0
    assert list(tmp_path.iterdir()) == []
