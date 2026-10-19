"""Issue #49 location API evidence against real, disposable PostgreSQL.

Ticket rows below are fixtures for history preservation, not implementation or
end-to-end verification of the separate #51 ticket-creation API.
"""

import importlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier, Event
from time import monotonic
from types import SimpleNamespace
from uuid import uuid4

import pytest
import yaml
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.main import create_app
from app.models import Location, Session as AuthSession, Ticket, User
from app.seed import SeedPasswords, seed_demo_data


ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}
PASSWORDS = {"REPORTER": "fixture-reporter", "TECHNICIAN": "fixture-technician", "ADMIN": "fixture-admin"}
ADDRESS = {"building": "测试楼", "floor": "3", "room_or_area": "301"}
BACKEND = Path(__file__).resolve().parents[1]
CONTRACT_URI = "urn:campusfix:locations-tests"


@pytest.fixture(scope="module")
def contract_registry():
    contract = yaml.safe_load((BACKEND.parent / "docs/api/openapi.yaml").read_text(encoding="utf-8"))
    return Registry().with_resource(
        CONTRACT_URI, Resource.from_contents(contract, default_specification=DRAFT202012),
    )


def assert_body_contract(response, schema, registry):
    Draft202012Validator(
        {"$ref": CONTRACT_URI + "#/components/schemas/" + schema},
        registry=registry, format_checker=FormatChecker(),
    ).validate(response.json())
    assert response.headers["x-request-id"].startswith("req_")


def assert_error(response, status, code, registry, fields=False):
    assert response.status_code == status, response.text
    assert_body_contract(response, "ErrorResponse", registry)
    error = response.json()["error"]
    assert error["code"] == code
    assert response.headers["x-request-id"] == error["request_id"]
    assert bool(error["field_errors"]) is fields
    assert "uq_locations" not in response.text and "sqlalchemy" not in response.text


@pytest.fixture
def settings():
    return Settings(
        _env_file=None, secret_key="location-test-secret-" + "x" * 32,
        allowed_origins=[ORIGIN], environment="test",
    )


def app_with_settings(settings, monkeypatch, engine=None):
    monkeypatch.setattr(importlib.import_module("app.main"), "get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    if engine is not None:
        def test_db():
            with Session(engine) as db:
                yield db
        app.dependency_overrides[get_db] = test_db
    return app


@pytest.fixture
def pg_engine():
    url = os.environ.get("CAMPUSFIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("CAMPUSFIX_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    if admin.dialect.name != "postgresql":
        admin.dispose()
        raise ValueError("Location integration tests require PostgreSQL")
    database = "campusfix_locations_test_" + uuid4().hex
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database}"'))
    engine = create_engine(make_url(url).set(database=database))
    try:
        with engine.connect() as connection:
            config = Config(str(BACKEND / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        passwords = SeedPasswords(
            _env_file=None, reporter_password=PASSWORDS["REPORTER"],
            technician_password=PASSWORDS["TECHNICIAN"], admin_password=PASSWORDS["ADMIN"],
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
def app(pg_engine, settings, monkeypatch):
    return app_with_settings(settings, monkeypatch, pg_engine)


def signed_in(app, role="ADMIN"):
    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        json={"email": role.lower() + "@example.invalid", "password": PASSWORDS[role]},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return client


def create_location(client, payload=None):
    return client.post("/api/admin/locations", json=ADDRESS if payload is None else payload, headers=HEADERS)


@pytest.mark.parametrize(("method", "path", "body"), [
    ("GET", "/api/locations", None),
    ("GET", "/api/admin/locations", None),
    ("POST", "/api/admin/locations", ADDRESS),
    ("PATCH", "/api/admin/locations/1", {"active": False}),
])
def test_all_location_routes_require_a_session_without_touching_database(
    settings, monkeypatch, method, path, body, contract_registry,
):
    response = TestClient(app_with_settings(settings, monkeypatch)).request(
        method, path, json=body, headers=HEADERS,
    )
    assert_error(response, 401, "UNAUTHORIZED", contract_registry)


@pytest.mark.parametrize(("method", "path", "body"), [
    ("POST", "/api/admin/locations", ADDRESS),
    ("PATCH", "/api/admin/locations/1", {"active": False}),
])
@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example.invalid"}])
def test_location_writes_require_allowed_origin_before_route_handling(
    settings, monkeypatch, method, path, body, headers, contract_registry,
):
    response = TestClient(app_with_settings(settings, monkeypatch)).request(method, path, json=body, headers=headers)
    assert_error(response, 403, "ORIGIN_NOT_ALLOWED", contract_registry)


def test_all_roles_read_active_locations_but_only_admin_manages_them(app, pg_engine, contract_registry):
    admin = signed_in(app)
    inactive = create_location(admin, {**ADDRESS, "active": False})
    assert inactive.status_code == 201
    inactive_id = inactive.json()["id"]
    for role in ("REPORTER", "TECHNICIAN", "ADMIN"):
        client = signed_in(app, role)
        response = client.get("/api/locations")
        assert response.status_code == 200
        assert_body_contract(response, "LocationList", contract_registry)
        assert response.json()["items"] and all(item["active"] for item in response.json()["items"])
        assert inactive_id not in {item["id"] for item in response.json()["items"]}
        if role != "ADMIN":
            for method, path, body in (
                ("GET", "/api/admin/locations", None),
                ("POST", "/api/admin/locations", {**ADDRESS, "room_or_area": role}),
                ("PATCH", f"/api/admin/locations/{inactive_id}", {"active": True}),
            ):
                forbidden = client.request(method, path, json=body, headers=HEADERS)
                assert_error(forbidden, 403, "FORBIDDEN", contract_registry)
    listing = admin.get("/api/admin/locations")
    assert listing.status_code == 200
    assert_body_contract(listing, "LocationList", contract_registry)
    assert any(item["id"] == inactive_id and item["active"] is False for item in listing.json()["items"])
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Location)) == 4
        assert db.get(Location, inactive_id).active is False


def test_create_edit_disable_enable_returns_current_utc_resource_without_deleting(app, pg_engine, contract_registry):
    admin = signed_in(app)
    created = create_location(admin)
    assert created.status_code == 201
    assert_body_contract(created, "Location", contract_registry)
    original = created.json()
    assert original["active"] is True
    assert original["created_at"].endswith("Z") and original["updated_at"].endswith("Z")
    edited = admin.patch(f"/api/admin/locations/{original['id']}", json={"floor": "4"}, headers=HEADERS)
    assert edited.status_code == 200
    assert_body_contract(edited, "Location", contract_registry)
    assert edited.json()["floor"] == "4"
    assert edited.json()["building"] == original["building"]
    assert edited.json()["room_or_area"] == original["room_or_area"]
    assert edited.json()["created_at"] == original["created_at"]
    for active in (False, True):
        changed = admin.patch(f"/api/admin/locations/{original['id']}", json={"active": active}, headers=HEADERS)
        assert changed.status_code == 200
        assert_body_contract(changed, "Location", contract_registry)
        assert changed.json()["active"] is active
        assert changed.json()["updated_at"].endswith("Z")
        assert (original["id"] in {item["id"] for item in admin.get("/api/locations").json()["items"]}) is active
        with Session(pg_engine) as db:
            row = db.get(Location, original["id"])
            assert row is not None and row.active is active
            assert db.scalar(select(func.count()).select_from(Location)) == 4


def test_location_input_and_path_validation_is_422_without_write_side_effects(app, pg_engine, contract_registry):
    admin = signed_in(app)
    created = create_location(admin).json()
    create_payloads = [
        {}, {"building": "楼", "floor": "3"}, {**ADDRESS, "building": ""},
        {**ADDRESS, "floor": None}, {**ADDRESS, "floor": 3}, {**ADDRESS, "room_or_area": False},
        {**ADDRESS, "active": "false"}, {**ADDRESS, "active": 0}, {**ADDRESS, "active": None},
        {**ADDRESS, "id": 9}, {**ADDRESS, "updated_at": "2026-10-10T00:00:00Z"},
    ]
    for payload in create_payloads:
        assert_error(create_location(admin, payload), 422, "VALIDATION_ERROR", contract_registry, fields=True)
    update_payloads = [
        {}, {"building": None}, {"floor": None}, {"room_or_area": None}, {"active": None},
        {"building": ""}, {"floor": 3}, {"active": "false"}, {"active": 0},
        {"active": False, "id": 2},
    ]
    for payload in update_payloads:
        response = admin.patch(f"/api/admin/locations/{created['id']}", json=payload, headers=HEADERS)
        assert_error(response, 422, "VALIDATION_ERROR", contract_registry, fields=True)
    for bad_id in ("0", "-1", "not-an-id", str(2**63)):
        response = admin.patch(f"/api/admin/locations/{bad_id}", json={"active": False}, headers=HEADERS)
        assert_error(response, 422, "VALIDATION_ERROR", contract_registry, fields=True)
    missing = admin.patch(f"/api/admin/locations/{2**63 - 1}", json={"active": False}, headers=HEADERS)
    assert_error(missing, 404, "NOT_FOUND", contract_registry)
    with Session(pg_engine) as db:
        row = db.get(Location, created["id"])
        assert (row.building, row.floor, row.room_or_area, row.active) == (*ADDRESS.values(), True)
        assert db.scalar(select(func.count()).select_from(Location)) == 4


def test_exact_location_text_is_not_trimmed_or_case_normalized(app, pg_engine):
    admin = signed_in(app)
    payload = {"building": " 测试楼 ", "floor": " 3 ", "room_or_area": " 301 "}
    created = create_location(admin, payload)
    assert created.status_code == 201
    assert {field: created.json()[field] for field in payload} == payload
    whitespace = {"building": " ", "floor": "\t", "room_or_area": "\n"}
    updated = admin.patch(f"/api/admin/locations/{created.json()['id']}", json=whitespace, headers=HEADERS)
    assert updated.status_code == 200
    assert {field: updated.json()[field] for field in whitespace} == whitespace
    with Session(pg_engine) as db:
        row = db.get(Location, created.json()["id"])
        assert (row.building, row.floor, row.room_or_area) == tuple(whitespace.values())


def test_active_list_can_be_empty_without_hiding_disabled_rows_from_admin(app, pg_engine, contract_registry):
    admin = signed_in(app)
    with Session(pg_engine) as db, db.begin():
        db.execute(update(Location).values(active=False))
    active = admin.get("/api/locations")
    assert active.status_code == 200 and active.json() == {"items": [], "next_cursor": None}
    assert_body_contract(active, "LocationList", contract_registry)
    complete = admin.get("/api/admin/locations")
    assert complete.status_code == 200 and len(complete.json()["items"]) == 3
    assert all(item["active"] is False for item in complete.json()["items"])
    assert_body_contract(complete, "LocationList", contract_registry)


def test_unique_combination_conflicts_include_disabled_rows_and_rollback_partial_updates(app, pg_engine, contract_registry):
    admin = signed_in(app)
    first = create_location(admin, {**ADDRESS, "active": False})
    assert first.status_code == 201
    assert_error(create_location(admin), 409, "CONFLICT", contract_registry)
    second = create_location(admin, {**ADDRESS, "room_or_area": "302"})
    assert second.status_code == 201
    before = second.json()
    conflicting = admin.patch(
        f"/api/admin/locations/{before['id']}",
        json={"room_or_area": "301", "active": False}, headers=HEADERS,
    )
    assert_error(conflicting, 409, "CONFLICT", contract_registry)
    with Session(pg_engine) as db:
        row = db.get(Location, before["id"])
        assert row.room_or_area == "302" and row.active is True
        assert row.updated_at.isoformat().replace("+00:00", "Z") == before["updated_at"]
        assert db.scalar(select(func.count()).select_from(Location)) == 5
    recovered = admin.patch(f"/api/admin/locations/{before['id']}", json={"room_or_area": "303"}, headers=HEADERS)
    assert recovered.status_code == 200 and recovered.json()["room_or_area"] == "303"


def test_cursor_pages_are_complete_stable_for_equal_timestamps_and_scope_bound(app, pg_engine, contract_registry):
    admin = signed_in(app)
    same_time = datetime(2026, 10, 10, 3, 20, tzinfo=timezone.utc)
    with Session(pg_engine) as db, db.begin():
        db.execute(update(Location).values(created_at=same_time))
        db.add_all([
            Location(**{**ADDRESS, "room_or_area": str(number)}, active=number % 2 == 0, created_at=same_time)
            for number in range(25)
        ])
    with Session(pg_engine) as db:
        expected_all = db.scalars(select(Location.id).order_by(Location.created_at.desc(), Location.id.desc())).all()
        expected_active = db.scalars(
            select(Location.id).where(Location.active.is_(True)).order_by(Location.created_at.desc(), Location.id.desc())
        ).all()
    default_page = admin.get("/api/admin/locations")
    assert default_page.status_code == 200 and len(default_page.json()["items"]) == 20
    assert default_page.json()["next_cursor"] is not None
    maximum_page = admin.get("/api/admin/locations", params={"limit": 100})
    assert len(maximum_page.json()["items"]) == len(expected_all)
    assert maximum_page.json()["next_cursor"] is None
    tokens = {}
    for path, expected in (("/api/admin/locations", expected_all), ("/api/locations", expected_active)):
        seen = []
        cursor = None
        while True:
            params = {"limit": 2}
            if cursor is not None:
                params["cursor"] = cursor
            response = admin.get(path, params=params)
            assert response.status_code == 200
            assert_body_contract(response, "LocationList", contract_registry)
            body = response.json()
            seen.extend(item["id"] for item in body["items"])
            cursor = body["next_cursor"]
            if path not in tokens and cursor is not None:
                tokens[path] = cursor
            if cursor is None:
                break
            assert len(seen) <= len(expected)
        assert seen == expected
        assert len(seen) == len(set(seen))
        for bad_limit in (0, -1, 101, "not-an-integer"):
            assert_error(admin.get(path, params={"limit": bad_limit}), 422, "VALIDATION_ERROR", contract_registry, fields=True)
        for bad_cursor in ("", "invalid", "x" * 1025):
            assert_error(admin.get(path, params={"cursor": bad_cursor}), 400, "VALIDATION_ERROR", contract_registry)
    for path, other in (("/api/locations", "/api/admin/locations"), ("/api/admin/locations", "/api/locations")):
        assert_error(admin.get(path, params={"cursor": tokens[other]}), 400, "VALIDATION_ERROR", contract_registry)


@pytest.mark.parametrize("invalidate", ["expired", "disabled", "unknown"])
def test_location_routes_recheck_existing_sessions_on_each_request(app, pg_engine, contract_registry, invalidate):
    admin = signed_in(app)
    admin_id = admin.get("/api/me").json()["id"]
    token = admin.cookies[SESSION_COOKIE_NAME]
    if invalidate == "unknown":
        admin.cookies.clear()
        admin.cookies.set(SESSION_COOKIE_NAME, "unknown-session-token")
    else:
        with Session(pg_engine) as db, db.begin():
            if invalidate == "disabled":
                db.execute(update(User).where(User.id == admin_id).values(active=False))
            else:
                db.execute(
                    update(AuthSession).where(AuthSession.token_hash == hash_session_token(token))
                    .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
                )
    for method, path, body in (
        ("GET", "/api/locations", None), ("GET", "/api/admin/locations", None),
        ("POST", "/api/admin/locations", ADDRESS),
        ("PATCH", "/api/admin/locations/1", {"active": False}),
    ):
        assert_error(admin.request(method, path, json=body, headers=HEADERS), 401, "UNAUTHORIZED", contract_registry)
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Location)) == 3
        assert all(db.scalars(select(Location.active)))


def test_rename_and_disable_leave_historical_ticket_snapshot_and_workflow_data_unchanged(app, pg_engine):
    admin = signed_in(app)
    location = create_location(admin).json()
    snapshot = "测试楼 / 3 / 301"
    with Session(pg_engine) as db, db.begin():
        reporter_id = db.scalar(select(User.id).where(User.role == "REPORTER"))
        ticket = Ticket(
            code="CF-20261010-900001", reporter_id=reporter_id, location_id=location["id"],
            location_label_snapshot=snapshot, title="历史快照夹具", description="仅验证地点修改不写入历史工单。",
            category="OTHER_FACILITY", status="SUBMITTED", version=1,
        )
        db.add(ticket)
        db.flush()
        ticket_id = ticket.id
    for payload in ({"building": "改名后的楼", "floor": "4"}, {"active": False}, {"active": True}):
        response = admin.patch(f"/api/admin/locations/{location['id']}", json=payload, headers=HEADERS)
        assert response.status_code == 200
        with Session(pg_engine) as db:
            ticket = db.get(Ticket, ticket_id)
            assert ticket.location_label_snapshot == snapshot
            assert (ticket.location_id, ticket.status, ticket.version, ticket.current_assignee_id) == (location["id"], "SUBMITTED", 1, None)
            assert db.get(Location, location["id"]) is not None
    # Included routers are lazy in the pinned FastAPI; exercise the HTTP path
    # rather than assuming app.routes exposes every included route directly.
    assert admin.delete(f"/api/admin/locations/{location['id']}", headers=HEADERS).status_code == 405
    with Session(pg_engine) as db:
        assert db.get(Location, location["id"]) is not None
        assert db.get(Ticket, ticket_id).location_label_snapshot == snapshot


@pytest.mark.parametrize("operation", ["create", "update"])
def test_failed_commit_rolls_back_location_mutation(app, pg_engine, contract_registry, operation):
    admin = signed_in(app)
    location = create_location(admin).json()
    with Session(pg_engine) as db:
        count_before = db.scalar(select(func.count()).select_from(Location))

    class FailingCommitSession(Session):
        def commit(self):
            self.flush()
            raise RuntimeError("injected location commit failure")

    def failing_db():
        with FailingCommitSession(pg_engine) as db:
            yield db

    app.dependency_overrides[get_db] = failing_db
    client = TestClient(app, raise_server_exceptions=False)
    client.cookies.update(admin.cookies)
    if operation == "create":
        response = create_location(client, {**ADDRESS, "room_or_area": "failed-create"})
    else:
        response = client.patch(
            f"/api/admin/locations/{location['id']}",
            json={"building": "failed-update", "active": False}, headers=HEADERS,
        )
    assert_error(response, 500, "INTERNAL_ERROR", contract_registry)
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Location)) == count_before
        row = db.get(Location, location["id"])
        assert row.building == ADDRESS["building"] and row.active is True
        assert row.updated_at.isoformat().replace("+00:00", "Z") == location["updated_at"]


@pytest.mark.parametrize(("sqlstate", "constraint"), [
    ("23514", "ck_locations_nonempty"),
    ("23505", "an_unrelated_unique_constraint"),
])
def test_other_integrity_failures_are_not_misreported_as_duplicate_locations(
    app, pg_engine, contract_registry, sqlstate, constraint,
):
    admin = signed_in(app)

    class UnrelatedDatabaseError(Exception):
        pass

    original = UnrelatedDatabaseError("private database internals")
    original.sqlstate = sqlstate
    original.diag = SimpleNamespace(constraint_name=constraint)

    class FailingFlushSession(Session):
        def flush(self, objects=None):
            if any(isinstance(row, Location) for row in self.new):
                raise IntegrityError("private SQL", {"private": "value"}, original)
            return super().flush(objects)

    def failing_db():
        with FailingFlushSession(pg_engine) as db:
            yield db

    app.dependency_overrides[get_db] = failing_db
    client = TestClient(app, raise_server_exceptions=False)
    client.cookies.update(admin.cookies)
    response = create_location(client)
    assert_error(response, 500, "INTERNAL_ERROR", contract_registry)
    assert "private" not in response.text and constraint not in response.text
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Location)) == 3


def test_concurrent_duplicate_creation_commits_exactly_one_location(app, pg_engine, contract_registry):
    clients = [signed_in(app), signed_in(app)]
    barrier = Barrier(2)

    def request(client):
        barrier.wait(timeout=10)
        return create_location(client)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(request, clients))
    assert sorted(response.status_code for response in responses) == [201, 409]
    for response in responses:
        if response.status_code == 201:
            assert_body_contract(response, "Location", contract_registry)
        else:
            assert_error(response, 409, "CONFLICT", contract_registry)
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Location).where(
            Location.building == ADDRESS["building"], Location.floor == ADDRESS["floor"],
            Location.room_or_area == ADDRESS["room_or_area"],
        )) == 1


def test_concurrent_partial_update_reads_current_values_after_waiting_for_row_lock(
    app, pg_engine, contract_registry,
):
    admin = signed_in(app)
    location = create_location(admin).json()
    started = Event()

    def update_other_fields():
        started.set()
        return admin.patch(
            f"/api/admin/locations/{location['id']}",
            json={"floor": "4", "active": True}, headers=HEADERS,
        )

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(pg_engine) as first:
            row = first.get(Location, location["id"], with_for_update=True)
            row.building = "另一事务改名后的楼"
            row.active = False
            first.flush()
            locker_pid = first.scalar(select(func.pg_backend_pid()))
            future = pool.submit(update_other_fields)
            try:
                assert started.wait(timeout=10)
                deadline = monotonic() + 10
                waiting = False
                # Observe PostgreSQL's actual lock wait, rather than assuming a
                # scheduling delay proves overlapping requests.
                with pg_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    while monotonic() < deadline:
                        waiting = bool(observer.scalar(text(
                            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                            "WHERE datname = current_database() AND pid <> :locker_pid "
                            "AND state = 'active' AND wait_event_type = 'Lock' "
                            "AND lower(query) LIKE '%locations%')"
                        ), {"locker_pid": locker_pid}))
                        if waiting or future.done():
                            break
                assert waiting, "The location PATCH must wait for the existing row lock."
                assert not future.done()
                first.commit()
            finally:
                # Always unblock the worker, including on assertion failure.
                first.rollback()
        response = future.result(timeout=10)
    assert response.status_code == 200
    assert_body_contract(response, "Location", contract_registry)
    body = response.json()
    assert (body["building"], body["floor"], body["active"]) == ("另一事务改名后的楼", "4", True)
    with Session(pg_engine) as db:
        row = db.get(Location, location["id"])
        assert (row.building, row.floor, row.active) == (body["building"], body["floor"], body["active"])
