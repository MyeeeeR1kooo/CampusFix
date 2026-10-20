"""Issue #50 Update 2 workflow actions against disposable PostgreSQL."""

import importlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
import yaml
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.main import create_app
from app.models import Assignment, Location, Session as AuthSession, Ticket, TicketEvent, User
from app.seed import SeedPasswords, seed_demo_data
from app.modules.workflow.rules import TRANSITIONS


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


def create_ticket(db, reporter, status="SUBMITTED", version=1, priority=None):
    location = db.scalar(select(Location).order_by(Location.id))
    row = Ticket(
        code=f"CF-20261020-{uuid4().int % 1_000_000:06d}",
        reporter_id=reporter.id, location_id=location.id,
        location_label_snapshot=f"{location.building} / {location.floor} / {location.room_or_area}",
        title="Workflow test ticket", description="Disposable integration fixture",
        category="LIGHTING_ELECTRICAL", priority=priority,
        status=status, version=version,
    )
    db.add(row)
    db.flush()
    return row.id


def ticket_fixture(engine, status="SUBMITTED", version=1, priority=None):
    with Session(engine) as db, db.begin():
        reporter = db.scalar(select(User).where(User.role == "REPORTER"))
        return create_ticket(db, reporter, status, version, priority)


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
