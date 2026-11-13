"""Real PostgreSQL evidence for #49's read seam, not the #51 create API.

The caller owns the transaction and must persist the returned snapshot with
Tickets / Workflow. These tests do not register a substitute creation route.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError, fields, is_dataclass
from queue import Queue
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import Location, Ticket, TicketEvent
from app.modules.locations.schemas import UpdateLocationRequest
from app.modules.locations.service import update_location
from app.modules.locations.ticket_selection import TicketLocationSnapshot, select_location_for_ticket
from test_locations_api import pg_engine  # Reuse its independent Alembic-migrated database fixture.


ADDRESS = {"building": " 测试楼 ", "floor": "\t3 ", "room_or_area": " 301\n"}
LABEL = " 测试楼  / \t3  /  301\n"


def create_location(engine, *, active=True):
    with Session(engine) as db, db.begin():
        row = Location(**ADDRESS, active=active)
        db.add(row)
        db.flush()
        return row.id


def assert_selection_error(error, status, code, *, field=False):
    assert error.status_code == status
    assert error.code == code
    if field:
        assert len(error.field_errors) == 1
        assert error.field_errors[0]["field"] == "location_id"
        assert error.field_errors[0]["type"] == "value_error"
    else:
        assert error.field_errors == []


def row_counts(engine):
    with Session(engine) as db:
        return tuple(db.scalar(select(func.count()).select_from(model)) for model in (Location, Ticket, TicketEvent))


def configure_worker(db, pids):
    # Bound server-side waits as well as Future.result(), so a failing assertion
    # cannot leave ThreadPoolExecutor shutdown waiting on a locked connection.
    db.execute(text("SET LOCAL statement_timeout = '15s'"))
    pids.put(db.scalar(select(func.pg_backend_pid())))


def assert_location_lock_wait(engine, pid, future):
    deadline = monotonic() + 10
    waiting = False
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while monotonic() < deadline:
            waiting = bool(observer.scalar(text(
                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                "WHERE datname = current_database() AND pid = :pid "
                "AND state = 'active' AND wait_event_type = 'Lock' "
                "AND lower(query) LIKE '%locations%')"
            ), {"pid": pid}))
            if waiting or future.done():
                break
    assert waiting, "PostgreSQL must report the actual location row-lock wait."
    assert not future.done()


def test_selection_returns_exact_text_as_an_immutable_non_orm_value(pg_engine):
    location_id = create_location(pg_engine)
    before = row_counts(pg_engine)
    with Session(pg_engine) as db, db.begin():
        snapshot = select_location_for_ticket(db, location_id)
        assert isinstance(snapshot, TicketLocationSnapshot)
        assert is_dataclass(snapshot)
        assert [field.name for field in fields(snapshot)] == ["location_id", "location_label_snapshot"]
        assert inspect(snapshot, raiseerr=False) is None
        assert snapshot.location_id == location_id
        assert snapshot.location_label_snapshot == LABEL
        with pytest.raises(FrozenInstanceError):
            snapshot.location_label_snapshot = "changed"
        with pytest.raises(FrozenInstanceError):
            snapshot.location_id = location_id + 1
        assert not db.new and not db.dirty and not db.deleted
    assert row_counts(pg_engine) == before
    # Returned scalar data remain usable after the session closes.
    assert snapshot.location_label_snapshot == LABEL


def test_missing_location_is_a_location_id_validation_error(pg_engine):
    before = row_counts(pg_engine)
    with Session(pg_engine) as db, db.begin():
        with pytest.raises(AppError) as raised:
            select_location_for_ticket(db, 2**63 - 1)
        assert_selection_error(raised.value, 422, "VALIDATION_ERROR", field=True)
        assert db.get_transaction().is_active
    assert row_counts(pg_engine) == before


def test_location_disabled_after_an_earlier_selection_is_rejected_on_reselection(pg_engine):
    location_id = create_location(pg_engine)
    with Session(pg_engine) as db, db.begin():
        original = select_location_for_ticket(db, location_id)
    with Session(pg_engine) as db:
        update_location(db, location_id, UpdateLocationRequest(active=False, building="已改名"))
    before = row_counts(pg_engine)
    with Session(pg_engine) as db, db.begin():
        with pytest.raises(AppError) as raised:
            select_location_for_ticket(db, location_id)
        assert_selection_error(raised.value, 409, "CONFLICT")
        assert db.get_transaction().is_active
    assert original.location_label_snapshot == LABEL
    assert row_counts(pg_engine) == before


@pytest.mark.parametrize("operation", ["success", "missing", "disabled"])
def test_selection_never_flushes_commits_or_rolls_back_the_callers_work(pg_engine, monkeypatch, operation):
    location_id = create_location(pg_engine, active=operation != "disabled")
    if operation == "missing":
        location_id = 2**63 - 1
    before = row_counts(pg_engine)
    pending = Location(building="未提交", floor="1", room_or_area="事务归调用方", active=True)

    def forbidden(*args, **kwargs):
        pytest.fail("Location selection must not flush, commit or roll back the caller's transaction.")

    with Session(pg_engine) as db:
        transaction = db.begin()
        db.add(pending)
        with monkeypatch.context() as patcher:
            for method in ("flush", "commit", "rollback"):
                patcher.setattr(db, method, forbidden)
            if operation == "success":
                assert select_location_for_ticket(db, location_id).location_label_snapshot == LABEL
            else:
                with pytest.raises(AppError) as raised:
                    select_location_for_ticket(db, location_id)
                if operation == "missing":
                    assert_selection_error(raised.value, 422, "VALIDATION_ERROR", field=True)
                else:
                    assert_selection_error(raised.value, 409, "CONFLICT")
        assert transaction.is_active
        assert pending in db.new and inspect(pending).pending
        assert pending.id is None
        assert row_counts(pg_engine) == before
        transaction.rollback()
    assert row_counts(pg_engine) == before


@pytest.mark.parametrize("disable", [False, True])
def test_selection_reads_current_database_values_not_a_stale_identity_map(pg_engine, disable):
    location_id = create_location(pg_engine)
    with Session(pg_engine) as reader:
        stale = reader.get(Location, location_id)
        assert stale.active is True and stale.building == ADDRESS["building"]
        with Session(pg_engine) as writer:
            update_location(
                writer, location_id,
                UpdateLocationRequest(building="数据库中的新名称", active=not disable),
            )
        assert reader.get(Location, location_id) is stale
        assert stale.active is True and stale.building == ADDRESS["building"]
        if disable:
            with pytest.raises(AppError) as raised:
                select_location_for_ticket(reader, location_id)
            assert_selection_error(raised.value, 409, "CONFLICT")
        else:
            snapshot = select_location_for_ticket(reader, location_id)
            assert snapshot.location_label_snapshot == "数据库中的新名称 / \t3  /  301\n"
        assert reader.get_transaction().is_active


@pytest.mark.parametrize("finish", ["commit", "rollback"])
def test_selection_blocks_maintenance_until_the_caller_ends_its_transaction(pg_engine, finish):
    location_id = create_location(pg_engine)
    pids = Queue()

    def maintain_location():
        with Session(pg_engine) as db:
            configure_worker(db, pids)
            return update_location(db, location_id, UpdateLocationRequest(building="维护改名", active=False))

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(pg_engine) as caller:
            caller.begin()
            snapshot = select_location_for_ticket(caller, location_id)
            future = pool.submit(maintain_location)
            try:
                assert_location_lock_wait(pg_engine, pids.get(timeout=10), future)
                getattr(caller, finish)()
            finally:
                # Release the lock even if an assertion or worker fails.
                caller.rollback()
        response = future.result(timeout=20)
    assert response.active is False and response.building == "维护改名"
    assert snapshot.location_label_snapshot == LABEL
    with Session(pg_engine) as db:
        row = db.get(Location, location_id)
        assert row.active is False and row.building == "维护改名"


@pytest.mark.parametrize("disable", [False, True])
def test_selection_waits_for_earlier_maintenance_and_uses_its_committed_values(pg_engine, disable):
    location_id = create_location(pg_engine)
    pids = Queue()

    def select_after_maintenance():
        with Session(pg_engine) as db, db.begin():
            configure_worker(db, pids)
            return select_location_for_ticket(db, location_id)

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(pg_engine) as maintainer:
            row = maintainer.get(Location, location_id, with_for_update=True)
            row.building = "先维护后读取"
            row.active = not disable
            maintainer.flush()
            future = pool.submit(select_after_maintenance)
            try:
                assert_location_lock_wait(pg_engine, pids.get(timeout=10), future)
                maintainer.commit()
            finally:
                maintainer.rollback()
        if disable:
            with pytest.raises(AppError) as raised:
                future.result(timeout=20)
            assert_selection_error(raised.value, 409, "CONFLICT")
        else:
            snapshot = future.result(timeout=20)
            assert snapshot.location_label_snapshot == "先维护后读取 / \t3  /  301\n"


def test_concurrent_selections_share_the_lock_without_blocking_each_other(pg_engine):
    location_id = create_location(pg_engine)
    selected = Event()
    release = Event()
    pids = Queue()

    def select_concurrently():
        with Session(pg_engine) as db, db.begin():
            configure_worker(db, pids)
            snapshot = select_location_for_ticket(db, location_id)
            selected.set()
            assert release.wait(timeout=10), "The test must release the second caller."
            return snapshot

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(pg_engine) as first:
            first.begin()
            original = select_location_for_ticket(first, location_id)
            future = pool.submit(select_concurrently)
            try:
                pids.get(timeout=10)
                assert selected.wait(timeout=5), "Concurrent location selections must both acquire FOR SHARE."
                assert not future.done()
                assert first.get_transaction().is_active
            finally:
                first.rollback()
                release.set()
        concurrent = future.result(timeout=20)
    assert concurrent == original
