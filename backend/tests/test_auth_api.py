"""Issue #47 authentication and account-management API evidence.

PostgreSQL cases use a disposable database created from
CAMPUSFIX_TEST_DATABASE_URL, never the application database.
"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.main import create_app
from app.models import Session as AuthSession, User
from app.modules.users.cursor import decode_cursor, encode_cursor
from app.seed import SeedPasswords, seed_demo_data


ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}
PASSWORDS = {
    "REPORTER": "fixture-reporter",
    "TECHNICIAN": "fixture-technician",
    "ADMIN": "fixture-admin",
}
EMAILS = {
    "REPORTER": "demo-reporter@example.invalid",
    "TECHNICIAN": "demo-technician@example.invalid",
    "ADMIN": "demo-admin@example.invalid",
}
BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def settings():
    return Settings(
        _env_file=None,
        secret_key="test-secret-" + "x" * 32,
        allowed_origins=[ORIGIN],
        environment="test",
        session_lifetime_seconds=8 * 60 * 60,
    )


def app_with_settings(settings, monkeypatch, engine=None):
    import importlib

    main_module = importlib.import_module("app.main")
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    if engine is not None:
        def test_db():
            with Session(engine) as session:
                yield session

        app.dependency_overrides[get_db] = test_db
    return app


@pytest.mark.parametrize(("method", "path", "body"), [
    ("GET", "/api/me", None),
    ("GET", "/api/admin/users", None),
    ("POST", "/api/auth/logout", None),
    ("PATCH", "/api/admin/users/1/active", {"active": False}),
])
def test_protected_routes_reject_missing_session(settings, monkeypatch, method, path, body):
    client = TestClient(app_with_settings(settings, monkeypatch))
    response = client.request(method, path, json=body, headers=HEADERS)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.parametrize(("method", "path", "body"), [
    ("POST", "/api/auth/login", {"email": EMAILS["REPORTER"], "password": "wrong"}),
    ("POST", "/api/auth/logout", None),
    ("PATCH", "/api/admin/users/1/active", {"active": False}),
])
def test_auth_writes_reject_missing_or_foreign_origin(settings, monkeypatch, method, path, body):
    client = TestClient(app_with_settings(settings, monkeypatch))
    for headers in ({}, {"Origin": "https://other.example"}):
        response = client.request(method, path, json=body, headers=headers)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"


@pytest.mark.parametrize("payload", [
    {"email": "invalid", "password": "example"},
    {"email": EMAILS["REPORTER"], "password": ""},
    {"email": EMAILS["REPORTER"], "password": "example", "role": "ADMIN"},
])
def test_login_rejects_invalid_payload_without_touching_database(settings, monkeypatch, payload):
    client = TestClient(app_with_settings(settings, monkeypatch))
    response = client.post("/api/auth/login", json=payload, headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_account_cursor_is_signed_and_bound_to_filters():
    created_at = datetime(2026, 10, 8, tzinfo=timezone.utc)
    token = encode_cursor(created_at, 2, "TECHNICIAN", True, "secret")
    assert decode_cursor(token, "TECHNICIAN", True, "secret") == (created_at, 2)
    changed = "A" if token[10] != "A" else "B"
    for candidate, role, active in (
        (token[:10] + changed + token[11:], "TECHNICIAN", True),
        (token, "REPORTER", True),
        (token, "TECHNICIAN", False),
        ("not a cursor", "TECHNICIAN", True),
    ):
        with pytest.raises(AppError) as exc:
            decode_cursor(candidate, role, active, "secret")
        assert exc.value.status_code == 400
        assert exc.value.code == "VALIDATION_ERROR"


@pytest.fixture
def pg_engine():
    url = os.environ.get("CAMPUSFIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("CAMPUSFIX_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    if admin.dialect.name != "postgresql":
        raise ValueError("Integration tests require PostgreSQL")
    database = "campusfix_auth_test_" + uuid4().hex
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
        with Session(engine) as session, session.begin():
            seed_demo_data(session, passwords)
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{database}"'))
        admin.dispose()


@pytest.fixture
def app(pg_engine, settings, monkeypatch):
    return app_with_settings(settings, monkeypatch, pg_engine)


def login(client, role):
    return client.post(
        "/api/auth/login",
        json={"email": EMAILS[role], "password": PASSWORDS[role]},
        headers=HEADERS,
    )


def test_three_roles_login_read_session_and_logout(app, pg_engine):
    for role in PASSWORDS:
        client = TestClient(app)
        response = login(client, role)
        assert response.status_code == 200
        assert response.json()["role"] == role
        assert set(response.json()) == {
            "id", "name", "email", "role", "active", "created_at", "updated_at"
        }
        assert response.json()["created_at"].endswith("Z")
        token = client.cookies[SESSION_COOKIE_NAME]
        cookie = response.headers["set-cookie"]
        assert all(flag in cookie for flag in ("HttpOnly", "SameSite=lax", "Max-Age=28800"))
        with Session(pg_engine) as db:
            stored = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_session_token(token)))
            assert stored is not None
            assert stored.token_hash != token
            assert db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.token_hash == token)) == 0
            assert timedelta(hours=7, minutes=59) < stored.expires_at - datetime.now(timezone.utc) <= timedelta(hours=8)
        assert client.get("/api/me").json()["role"] == role
        out = client.post("/api/auth/logout", headers=HEADERS)
        assert out.status_code == 204 and out.content == b""
        assert "Max-Age=0" in out.headers["set-cookie"]
        assert client.get("/api/me").status_code == 401
        with Session(pg_engine) as db:
            assert db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.token_hash == hash_session_token(token))) == 0


def test_login_failure_is_uniform_and_does_not_create_sessions(app, pg_engine):
    client = TestClient(app)
    cases = [
        ("absent@example.invalid", PASSWORDS["REPORTER"]),
        (EMAILS["REPORTER"], "wrong-password"),
    ]
    failures = []
    for email, password in cases:
        response = client.post("/api/auth/login", json={"email": email, "password": password}, headers=HEADERS)
        assert response.status_code == 401
        assert "set-cookie" not in response.headers
        failures.append(response.json()["error"])
    assert [(error["code"], error["message"], error["field_errors"]) for error in failures] == [
        ("UNAUTHORIZED", "Authentication failed.", []),
    ] * 2
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_admin_account_management_revokes_existing_sessions(app, pg_engine):
    admin = TestClient(app)
    reporter = TestClient(app)
    technician = TestClient(app)
    assert login(admin, "ADMIN").status_code == 200
    assert login(reporter, "REPORTER").status_code == 200
    assert login(technician, "TECHNICIAN").status_code == 200
    reporter_token = reporter.cookies[SESSION_COOKIE_NAME]
    admin_id = admin.get("/api/me").json()["id"]
    reporter_id = reporter.get("/api/me").json()["id"]

    first = admin.get("/api/admin/users", params={"limit": 1})
    assert first.status_code == 200
    assert len(first.json()["items"]) == 1
    assert first.json()["next_cursor"] is not None
    second = admin.get("/api/admin/users", params={"limit": 1, "cursor": first.json()["next_cursor"]})
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert second.json()["next_cursor"] is None
    assert {first.json()["items"][0]["role"], second.json()["items"][0]["role"]} == {"REPORTER", "TECHNICIAN"}
    assert admin.get("/api/admin/users", params={"role": "TECHNICIAN", "active": True}).json()["items"][0]["role"] == "TECHNICIAN"
    assert admin.get("/api/admin/users", params={"limit": 0}).status_code == 422
    assert admin.get("/api/admin/users", params={"role": "ADMIN"}).status_code == 422
    assert admin.get("/api/admin/users", params={"cursor": ""}).status_code == 400
    bad_cursor = admin.get("/api/admin/users", params={"role": "REPORTER", "cursor": first.json()["next_cursor"]})
    assert bad_cursor.status_code == 400
    assert reporter.get("/api/admin/users").status_code == 403
    assert technician.patch(f"/api/admin/users/{reporter_id}/active", json={"active": False}, headers=HEADERS).status_code == 403
    assert admin.patch(f"/api/admin/users/{admin_id}/active", json={"active": False}, headers=HEADERS).status_code == 403
    assert admin.patch("/api/admin/users/999999/active", json={"active": False}, headers=HEADERS).status_code == 404
    assert admin.patch(f"/api/admin/users/{reporter_id}/active", json={"active": "false"}, headers=HEADERS).status_code == 422
    assert admin.patch(f"/api/admin/users/{reporter_id}/active", json={"active": False, "role": "ADMIN"}, headers=HEADERS).status_code == 422

    disabled = admin.patch(f"/api/admin/users/{reporter_id}/active", json={"active": False}, headers=HEADERS)
    assert disabled.status_code == 200 and disabled.json()["active"] is False
    inactive = admin.get("/api/admin/users", params={"active": False})
    assert [item["id"] for item in inactive.json()["items"]] == [reporter_id]
    assert reporter.get("/api/me").status_code == 401
    disabled_login = login(TestClient(app), "REPORTER")
    assert (disabled_login.status_code, disabled_login.json()["error"]["message"]) == (401, "Authentication failed.")
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.token_hash == hash_session_token(reporter_token))) == 0
    enabled = admin.patch(f"/api/admin/users/{reporter_id}/active", json={"active": True}, headers=HEADERS)
    assert enabled.status_code == 200 and enabled.json()["active"] is True
    assert reporter.get("/api/me").status_code == 401
    assert login(TestClient(app), "REPORTER").status_code == 200


def test_expired_session_is_rejected_without_sliding_renewal(app, pg_engine):
    client = TestClient(app)
    assert login(client, "REPORTER").status_code == 200
    token = client.cookies[SESSION_COOKIE_NAME]
    with Session(pg_engine) as db, db.begin():
        db.execute(
            update(AuthSession)
            .where(AuthSession.token_hash == hash_session_token(token))
            .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
    assert client.get("/api/me").status_code == 401
    assert client.post("/api/auth/logout", headers=HEADERS).status_code == 401


def test_failed_session_commit_does_not_issue_cookie(app, pg_engine):
    class FailingCommitSession(Session):
        def commit(self):
            raise RuntimeError("injected commit failure")

    def failing_db():
        with FailingCommitSession(pg_engine) as db:
            yield db

    app.dependency_overrides[get_db] = failing_db
    response = login(TestClient(app, raise_server_exceptions=False), "REPORTER")
    assert response.status_code == 500
    assert "set-cookie" not in response.headers
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_failed_account_update_keeps_user_and_session_active(app, pg_engine):
    admin = TestClient(app)
    reporter = TestClient(app)
    assert login(admin, "ADMIN").status_code == 200
    assert login(reporter, "REPORTER").status_code == 200
    reporter_id = reporter.get("/api/me").json()["id"]
    token = reporter.cookies[SESSION_COOKIE_NAME]

    class FailingCommitSession(Session):
        def commit(self):
            raise RuntimeError("injected commit failure")

    def failing_db():
        with FailingCommitSession(pg_engine) as db:
            yield db

    original_db = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = failing_db
    response = TestClient(app, raise_server_exceptions=False)
    response.cookies.update(admin.cookies)
    failed = response.patch(f"/api/admin/users/{reporter_id}/active", json={"active": False}, headers=HEADERS)
    assert failed.status_code == 500
    app.dependency_overrides[get_db] = original_db
    assert reporter.get("/api/me").status_code == 200
    with Session(pg_engine) as db:
        assert db.get(User, reporter_id).active is True
        assert db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.token_hash == hash_session_token(token))) == 1
