"""#45: real PostgreSQL migration, constraints and anonymous seed evidence.

Set CAMPUSFIX_TEST_DATABASE_URL to a dedicated PostgreSQL test database.
The test role needs CREATEDB. Each test creates and drops its own database.
"""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import verify_password
from app.models import Assignment, Attachment, Base, Comment, Location, Session as AuthSession, Ticket, TicketEvent, User
from app.seed import DEMO_ACCOUNTS, SeedPasswords, main, seed_demo_data


BACKEND = Path(__file__).resolve().parents[1]
TABLES = {"users", "sessions", "locations", "tickets", "assignments", "ticket_events", "comments", "attachments"}


def migration_config(connection):
    config = Config(str(BACKEND / "alembic.ini"))
    config.attributes["connection"] = connection
    return config


@pytest.fixture
def pg_engine():
    url = os.environ.get("CAMPUSFIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("CAMPUSFIX_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    if admin.dialect.name != "postgresql":
        raise ValueError("Integration tests require PostgreSQL, not SQLite")
    database = "campusfix_test_" + uuid4().hex
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database}"'))
    engine = create_engine(make_url(url).set(database=database))
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{database}"'))
        admin.dispose()


@pytest.fixture
def migrated_engine(pg_engine):
    with pg_engine.connect() as connection:
        command.upgrade(migration_config(connection), "head")
    return pg_engine


@pytest.fixture
def passwords():
    # Invented test credentials, deliberately separate from local demo .env.
    return SeedPasswords(
        _env_file=None,
        reporter_password="fixture-reporter",
        technician_password="fixture-technician",
        admin_password="fixture-admin",
    )


@pytest.fixture
def seeded_session(migrated_engine, passwords):
    with Session(migrated_engine) as session, session.begin():
        seed_demo_data(session, passwords)
        yield session


def ticket_values(session, **changes):
    values = dict(
        code="CF-20261002-000001",
        reporter_id=session.scalar(select(User.id).where(User.role == "REPORTER")),
        location_id=session.scalar(select(Location.id).order_by(Location.id)),
        location_label_snapshot="演示楼 A / 1 / 示例房间 101",
        title="虚构灯具故障", description="仅用于数据库测试", category="LIGHTING_ELECTRICAL",
    )
    values.update(changes)
    return values


def test_fresh_upgrade_rollback_and_upgrade_again(pg_engine):
    with pg_engine.connect() as connection:
        config = migration_config(connection)
        command.upgrade(config, "head")
        assert set(inspect(connection).get_table_names()) == TABLES | {"alembic_version"}
        command.upgrade(config, "head")
        command.downgrade(config, "base")
        assert inspect(connection).get_table_names() == ["alembic_version"]
        command.upgrade(config, "head")
        assert set(inspect(connection).get_table_names()) == TABLES | {"alembic_version"}


def test_migration_matches_models_and_p0_types(migrated_engine):
    with migrated_engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        inspector = inspect(connection)
        for table in TABLES:
            columns = {column["name"]: column for column in inspector.get_columns(table)}
            assert columns["id"]["identity"]
            assert str(columns["id"]["type"]) == "BIGINT"
            for name, column in columns.items():
                if name.endswith("_at"):
                    assert column["type"].timezone is True
            for foreign_key in inspector.get_foreign_keys(table):
                assert foreign_key["options"].get("ondelete", "NO ACTION") in {"NO ACTION", "RESTRICT"}


def test_six_query_indexes_and_single_current_assignment(migrated_engine):
    expected = {
        "ix_tickets_reporter_created_id": "(reporter_id, created_at DESC, id DESC)",
        "ix_tickets_assignee_created_id": "(current_assignee_id, created_at DESC, id DESC)",
        "ix_tickets_status_created_id": "(status, created_at DESC, id DESC)",
        "ix_tickets_location_created_id": "(location_id, created_at DESC, id DESC)",
        "ix_ticket_events_ticket_created_id": "(ticket_id, created_at, id)",
        "ix_comments_ticket_created_id": "(ticket_id, created_at, id)",
    }
    with migrated_engine.connect() as connection:
        indexes = dict(connection.execute(text("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()")).all())
        for name, definition in expected.items():
            assert definition in indexes[name]
        assert "UNIQUE INDEX" in indexes["uq_assignments_current_ticket"]
        assert "WHERE (ended_at IS NULL)" in indexes["uq_assignments_current_ticket"]


def test_seed_is_idempotent_and_preserves_existing_accounts(migrated_engine, passwords):
    with Session(migrated_engine) as session, session.begin():
        first = seed_demo_data(session, passwords)
        assert (first.users_created, first.locations_created) == (3, 3)
        reporter = session.scalar(select(User).where(User.role == "REPORTER"))
        reporter.active = False
        session.flush()
        before = session.execute(select(User.id, User.password_hash, User.active, User.updated_at).order_by(User.id)).all()
        second = seed_demo_data(session, passwords)
        assert (second.users_created, second.locations_created) == (0, 0)
        assert session.execute(select(User.id, User.password_hash, User.active, User.updated_at).order_by(User.id)).all() == before
        assert session.scalar(select(func.count()).select_from(Location)) == 3
        assert session.scalar(select(func.count()).select_from(Ticket)) == 0
        for user in session.scalars(select(User)):
            assert user.password_hash.startswith("$argon2id$")
            assert verify_password(passwords.for_role(user.role), user.password_hash)
            assert not verify_password("incorrect-password", user.password_hash)
            assert user.email.endswith("@example.invalid")
            assert passwords.for_role(user.role) not in user.password_hash
            assert user.created_at.utcoffset().total_seconds() == 0


def test_seed_role_collision_rolls_back_all_rows(migrated_engine, passwords):
    with Session(migrated_engine) as session, session.begin():
        session.add(User(name="虚构账户", email=DEMO_ACCOUNTS[1][2], role="REPORTER", password_hash="existing"))
    with pytest.raises(ValueError, match="different role"):
        with Session(migrated_engine) as session, session.begin():
            seed_demo_data(session, passwords)
    with Session(migrated_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(Location)) == 0


def test_seed_cli_commits_and_does_not_log_passwords(migrated_engine, passwords, monkeypatch, capsys):
    from app.core import database

    monkeypatch.setattr(database, "SessionLocal", sessionmaker(migrated_engine))
    for role, _, _ in DEMO_ACCOUNTS:
        monkeypatch.setenv("SEED_" + role + "_PASSWORD", passwords.for_role(role))
    assert main() == 0
    assert main() == 0
    output = capsys.readouterr()
    assert "3 users, 3 locations" in output.out
    assert "0 users, 0 locations" in output.out
    assert not output.err
    for role, _, _ in DEMO_ACCOUNTS:
        assert passwords.for_role(role) not in output.out
    with Session(migrated_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 3


@pytest.mark.parametrize("changes", [
    {"status": "INVALID"}, {"category": "IT"}, {"priority": "URGENT"},
    {"version": 0}, {"status": "PENDING_ASSIGNMENT", "priority": None},
    {"closed_at": "2026-10-02T00:00:00Z"},
    {"status": "ASSIGNED", "priority": "LOW", "current_assignee_id": None},
])
def test_ticket_constraints_reject_invalid_rows(seeded_session, changes):
    from datetime import datetime

    if "closed_at" in changes:
        changes = {**changes, "closed_at": datetime.fromisoformat(changes["closed_at"])}
    with pytest.raises(IntegrityError):
        with seeded_session.begin_nested():
            seeded_session.add(Ticket(**ticket_values(seeded_session, **changes)))
            seeded_session.flush()


@pytest.mark.parametrize("status", ["SUBMITTED", "REJECTED", "CANCELLED", "PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED"])
def test_all_p0_ticket_states_can_be_stored(seeded_session, status):
    from datetime import datetime, timezone

    assigned = status in {"ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED"}
    ticket = Ticket(**ticket_values(
        seeded_session, status=status,
        priority=None if status in {"SUBMITTED", "REJECTED", "CANCELLED"} else "MEDIUM",
        current_assignee_id=seeded_session.scalar(select(User.id).where(User.role == "TECHNICIAN")) if assigned else None,
        closed_at=datetime.now(timezone.utc) if status == "CLOSED" else None,
    ))
    seeded_session.add(ticket)
    seeded_session.flush()
    assert ticket.id > 0 and ticket.version == 1


def test_duplicate_assignment_and_referenced_user_delete_are_rejected(seeded_session):
    ticket = Ticket(**ticket_values(seeded_session))
    seeded_session.add(ticket)
    seeded_session.flush()
    assignment = dict(
        ticket_id=ticket.id,
        technician_id=seeded_session.scalar(select(User.id).where(User.role == "TECHNICIAN")),
        assigned_by=seeded_session.scalar(select(User.id).where(User.role == "ADMIN")),
    )
    seeded_session.add(Assignment(**assignment))
    seeded_session.flush()
    with pytest.raises(IntegrityError):
        with seeded_session.begin_nested():
            seeded_session.add(Assignment(**assignment))
            seeded_session.flush()
    with pytest.raises(IntegrityError):
        with seeded_session.begin_nested():
            seeded_session.execute(text("DELETE FROM users WHERE id = :id"), {"id": ticket.reporter_id})


@pytest.mark.parametrize("table,changes", [
    ("users", {"role": "SUPERUSER"}),
    ("users", {"email": "demo-reporter@example.invalid"}),
    ("locations", {"building": ""}),
    ("locations", {"floor": ""}),
    ("locations", {"room_or_area": ""}),
    ("locations", {"building": "演示楼 A", "floor": "1", "room_or_area": "示例房间 101"}),
    ("comments", {"visibility": "PRIVATE"}),
    ("ticket_events", {"visibility": "PRIVATE"}),
    ("ticket_events", {"from_status": "INVALID"}),
    ("ticket_events", {"to_status": "INVALID"}),
    ("attachments", {"purpose": "AVATAR"}),
])
def test_other_p0_checks_and_unique_keys(seeded_session, table, changes):
    ticket = Ticket(**ticket_values(seeded_session))
    seeded_session.add(ticket)
    seeded_session.flush()
    values = {
        "users": (User, dict(name="虚构账户", email="fixture@example.invalid", password_hash="fixture", role="REPORTER")),
        "locations": (Location, dict(building="测试楼", floor="1", room_or_area="示例")),
        "comments": (Comment, dict(ticket_id=ticket.id, author_id=ticket.reporter_id, body="虚构留言", visibility="PUBLIC")),
        "ticket_events": (TicketEvent, dict(ticket_id=ticket.id, actor_id=ticket.reporter_id, type="TICKET_SUBMITTED", to_status="SUBMITTED", visibility="PUBLIC")),
        "attachments": (Attachment, dict(ticket_id=ticket.id, uploader_id=ticket.reporter_id, storage_key="fixture-key", original_name="fixture.png", mime="image/png", size=100, purpose="REPORT_PHOTO")),
    }
    model, fields = values[table]
    with pytest.raises(IntegrityError):
        with seeded_session.begin_nested():
            seeded_session.add(model(**{**fields, **changes}))
            seeded_session.flush()


def test_session_token_and_attachment_storage_key_are_unique(seeded_session):
    from datetime import datetime, timedelta, timezone

    ticket = Ticket(**ticket_values(seeded_session))
    seeded_session.add(ticket)
    seeded_session.flush()
    session_fields = dict(user_id=ticket.reporter_id, token_hash="0" * 64, expires_at=datetime.now(timezone.utc) + timedelta(hours=8))
    attachment_fields = dict(ticket_id=ticket.id, uploader_id=ticket.reporter_id, storage_key="fixture-key", original_name="fixture.png", mime="image/png", size=100, purpose="REPORT_PHOTO")
    seeded_session.add_all([AuthSession(**session_fields), Attachment(**attachment_fields)])
    seeded_session.flush()
    for model, fields in ((AuthSession, session_fields), (Attachment, attachment_fields)):
        with pytest.raises(IntegrityError):
            with seeded_session.begin_nested():
                seeded_session.add(model(**fields))
                seeded_session.flush()


def test_two_seed_processes_do_not_duplicate_rows(migrated_engine, passwords):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    ready = Barrier(2)

    def run_seed():
        with Session(migrated_engine) as session, session.begin():
            ready.wait(timeout=5)
            return seed_demo_data(session, passwords)

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: run_seed(), range(2)))
    assert sum(result.users_created for result in results) == 3
    assert sum(result.locations_created for result in results) == 3
    with Session(migrated_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 3
        assert session.scalar(select(func.count()).select_from(Location)) == 3


def test_seed_cli_rejects_blank_password_without_logging_inputs(monkeypatch, capsys):
    monkeypatch.setenv("SEED_REPORTER_PASSWORD", "")
    monkeypatch.setenv("SEED_TECHNICIAN_PASSWORD", "private-fixture-password")
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "private-fixture-password")
    assert main() == 1
    output = capsys.readouterr()
    assert "SEED_REPORTER_PASSWORD" in output.err
    assert "private-fixture-password" not in output.err
