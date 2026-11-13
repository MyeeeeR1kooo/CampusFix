"""Issue #51 internal reads against real, Alembic-migrated PostgreSQL.

Ticket/status/event rows here are query fixtures, not creation or Workflow
implementation. These tests do not register substitute HTTP routes or claim a
complete public response: internal read data omit the three Workflow projection
fields, whose integration is covered by the separate HTTP tests.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import Assignment, Attachment, Comment, Location, Ticket, TicketEvent, User
from app.modules.tickets.detail_reads import get_ticket_read
from app.modules.tickets.reads import list_ticket_reads
from app.modules.tickets.schemas import TicketListFilters
from test_locations_api import pg_engine  # noqa: F401 -- reuse disposable PG migration fixture


STAMP = datetime(2026, 10, 12, 3, 0, tzinfo=timezone.utc)
SECRET = "ticket-read-fixture-only-" + "x" * 32
CONTRACT_URI = "urn:campusfix:ticket-read-tests"
BACKEND = Path(__file__).resolve().parents[1]
WORKFLOW_FIELDS = {"current_responsible_role", "next_action", "allowed_actions"}


@pytest.fixture(scope="module")
def read_contract_registry():
    contract = yaml.safe_load((BACKEND.parent / "docs/api/openapi.yaml").read_text(encoding="utf-8"))
    return Registry().with_resource(
        CONTRACT_URI, Resource.from_contents(contract, default_specification=DRAFT202012),
    )


def assert_component(payload, name, registry):
    Draft202012Validator(
        {"$ref": CONTRACT_URI + "#/components/schemas/" + name},
        registry=registry, format_checker=FormatChecker(),
    ).validate(payload)


@contextmanager
def capture_sql(engine):
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def item_ids(result):
    return [item.id for item in result.items]


def list_reads(db, actor, **filters):
    return list_ticket_reads(
        db, actor=actor, filters=TicketListFilters(**filters), secret_key=SECRET,
    )


def assert_error(caught, status, code):
    assert caught.value.status_code == status
    assert caught.value.code == code


@pytest.fixture
def read_data(pg_engine):
    with Session(pg_engine, expire_on_commit=False) as db, db.begin():
        users = {row.role: row for row in db.scalars(select(User)).all()}
        users["OTHER_REPORTER"] = User(
            name="Other fixture reporter", email="other-reporter@example.invalid",
            role="REPORTER", password_hash="private-fixture-password-hash", active=True,
        )
        users["OTHER_TECHNICIAN"] = User(
            name="Other fixture technician", email="other-technician@example.invalid",
            role="TECHNICIAN", password_hash="private-fixture-password-hash", active=True,
        )
        db.add_all([users["OTHER_REPORTER"], users["OTHER_TECHNICIAN"]])
        locations = [
            Location(building="Current A", floor="1", room_or_area="A", active=True),
            Location(building="Current B", floor="2", room_or_area="B", active=False),
        ]
        db.add_all(locations)
        db.flush()
        # index, reporter, status, assignee, priority, location, category, time
        specs = [
            ("REPORTER", "SUBMITTED", None, None, 0, "LIGHTING_ELECTRICAL", STAMP),
            ("OTHER_REPORTER", "SUBMITTED", None, None, 1, "HVAC", STAMP - timedelta(days=1)),
            ("REPORTER", "ASSIGNED", "TECHNICIAN", "HIGH", 0, "LIGHTING_ELECTRICAL", STAMP),
            ("OTHER_REPORTER", "ASSIGNED", "TECHNICIAN", "MEDIUM", 1, "HVAC", STAMP),
            ("REPORTER", "CLOSED", "TECHNICIAN", "LOW", 1, "HVAC", STAMP),
            ("REPORTER", "ASSIGNED", "OTHER_TECHNICIAN", "HIGH", 0, "FURNITURE", STAMP),
            ("REPORTER", "PENDING_ASSIGNMENT", None, "LOW", 0, "LIGHTING_ELECTRICAL", STAMP),
            ("REPORTER", "IN_PROGRESS", "TECHNICIAN", "MEDIUM", 1, "HVAC", STAMP + timedelta(hours=1)),
        ]
        tickets = []
        for index, (reporter, status, assignee, priority, location, category, stamp) in enumerate(specs):
            ticket = Ticket(
                code=f"CF-20261012-{index + 1:06d}", reporter_id=users[reporter].id,
                location_id=locations[location].id, location_label_snapshot=f"Historical {location} / 9 / old",
                title=f"Fixture title {index}", description=f"Fixture description {index}",
                category=category, priority=priority, status=status,
                current_assignee_id=users[assignee].id if assignee else None,
                version=2 if assignee else 1, created_at=stamp, updated_at=stamp,
                closed_at=stamp + timedelta(minutes=10) if status == "CLOSED" else None,
            )
            db.add(ticket)
            tickets.append(ticket)
        db.flush()
        target = tickets[2].id
        other = tickets[3].id
        assignments = [
            Assignment(ticket_id=target, technician_id=users["TECHNICIAN"].id,
                       assigned_by=users["ADMIN"].id, assigned_at=STAMP, ended_at=None, reason=None),
            Assignment(ticket_id=other, technician_id=users["TECHNICIAN"].id,
                       assigned_by=users["ADMIN"].id, assigned_at=STAMP, ended_at=None, reason="other ticket"),
        ]
        photos = [
            Attachment(ticket_id=target, uploader_id=users["REPORTER"].id,
                       storage_key="private/report/fixture.jpg", original_name="report.jpg",
                       mime="image/jpeg", size=123, purpose="REPORT_PHOTO", created_at=STAMP),
            Attachment(ticket_id=target, uploader_id=users["TECHNICIAN"].id,
                       storage_key="private/resolution/fixture.png", original_name="resolution.png",
                       mime="image/png", size=456, purpose="RESOLUTION_PHOTO", created_at=STAMP),
            Attachment(ticket_id=other, uploader_id=users["OTHER_REPORTER"].id,
                       storage_key="private/other/fixture.webp", original_name="other.webp",
                       mime="image/webp", size=789, purpose="REPORT_PHOTO", created_at=STAMP),
        ]
        events = [
            TicketEvent(ticket_id=target, actor_id=users["REPORTER"].id, type="TICKET_SUBMITTED",
                        from_status=None, to_status="SUBMITTED", note=None, visibility="PUBLIC", created_at=STAMP),
            TicketEvent(ticket_id=target, actor_id=users["ADMIN"].id, type="TICKET_APPROVED",
                        from_status="SUBMITTED", to_status="PENDING_ASSIGNMENT", note="private event",
                        visibility="ADMIN_ONLY", created_at=STAMP),
            TicketEvent(ticket_id=target, actor_id=users["ADMIN"].id, type="TICKET_ASSIGNED",
                        from_status="PENDING_ASSIGNMENT", to_status="ASSIGNED", note=None,
                        visibility="PUBLIC", created_at=STAMP),
            TicketEvent(ticket_id=other, actor_id=users["OTHER_REPORTER"].id, type="TICKET_SUBMITTED",
                        from_status=None, to_status="SUBMITTED", note="other ticket",
                        visibility="PUBLIC", created_at=STAMP),
        ]
        comments = [
            Comment(ticket_id=target, author_id=users["REPORTER"].id, body="early public",
                    visibility="PUBLIC", created_at=STAMP - timedelta(seconds=1)),
            Comment(ticket_id=target, author_id=users["ADMIN"].id, body="private comment",
                    visibility="ADMIN_ONLY", created_at=STAMP),
            Comment(ticket_id=target, author_id=users["TECHNICIAN"].id, body="public comment",
                    visibility="PUBLIC", created_at=STAMP),
            Comment(ticket_id=other, author_id=users["OTHER_REPORTER"].id, body="other ticket",
                    visibility="PUBLIC", created_at=STAMP),
        ]
        db.add_all(assignments + photos + events + comments)
        db.flush()
        result = SimpleNamespace(
            engine=pg_engine, users=users, locations=locations,
            ids=[ticket.id for ticket in tickets], specs=specs, photos=photos,
            assignments=assignments, events=events, comments=comments,
        )
    return result


def test_role_scopes_are_applied_before_seek_and_limit_including_closed_history(read_data):
    data = read_data
    expected = {
        "REPORTER": [7, 6, 5, 4, 2, 0],
        "OTHER_REPORTER": [3, 1],
        "TECHNICIAN": [7, 4, 3, 2],
        "OTHER_TECHNICIAN": [5],
        "ADMIN": [7, 6, 5, 4, 3, 2, 0, 1],
    }
    with Session(data.engine) as db:
        for role, indices in expected.items():
            seen = []
            cursor = None
            while True:
                page = list_reads(db, data.users[role], limit=1, cursor=cursor)
                seen.extend(item_ids(page))
                if page.next_cursor is None:
                    break
                assert len(page.items) == 1
                cursor = page.next_cursor
            assert seen == [data.ids[index] for index in indices]
        closed = get_ticket_read(db, actor=data.users["TECHNICIAN"], ticket_id=data.ids[4])
        assert closed.status == "CLOSED" and closed.closed_at is not None
        assert closed.current_assignee.id == data.users["TECHNICIAN"].id
        no_children = get_ticket_read(db, actor=data.users["REPORTER"], ticket_id=data.ids[0])
        assert no_children.current_assignee is None and no_children.closed_at is None
        assert no_children.report_photos == no_children.resolution_photos == ()
        assert no_children.assignments == no_children.timeline == ()


def test_common_filters_and_admin_assignee_are_combined_with_and_and_utc_boundaries(read_data):
    data = read_data
    with Session(data.engine) as db:
        filters = dict(
            status="ASSIGNED", category="LIGHTING_ELECTRICAL", priority="HIGH", building="Current A",
            created_from=STAMP, created_before=STAMP + timedelta(seconds=1),
            current_assignee_id=data.users["TECHNICIAN"].id,
        )
        assert item_ids(list_reads(db, data.users["ADMIN"], **filters)) == [data.ids[2]]
        assert item_ids(list_reads(db, data.users["ADMIN"], created_from=STAMP,
                                   created_before=STAMP + timedelta(hours=1))) == list(reversed(data.ids[2:7])) + [data.ids[0]]
        assert item_ids(list_reads(db, data.users["ADMIN"], created_from=STAMP + timedelta(hours=1))) == [data.ids[7]]
        assert item_ids(list_reads(db, data.users["ADMIN"], created_before=STAMP)) == [data.ids[1]]
        for role in ("REPORTER", "TECHNICIAN"):
            with pytest.raises(AppError) as caught:
                list_reads(db, data.users[role], current_assignee_id=data.users["TECHNICIAN"].id)
            assert_error(caught, 403, "FORBIDDEN")
        empty = list_reads(db, data.users["ADMIN"], category="WATER_SANITARY")
        assert empty.items == () and empty.next_cursor is None


def test_building_uses_current_location_without_hiding_disabled_history_and_snapshot_is_stable(read_data):
    data = read_data
    with Session(data.engine) as db:
        before = get_ticket_read(db, actor=data.users["REPORTER"], ticket_id=data.ids[0])
    with Session(data.engine) as maintenance, maintenance.begin():
        maintenance.execute(update(Location).where(Location.id == data.locations[0].id).values(
            building="Renamed A", floor="99", room_or_area="changed", active=False,
        ))
    with Session(data.engine) as db:
        after = get_ticket_read(db, actor=data.users["REPORTER"], ticket_id=data.ids[0])
        assert after.location_label_snapshot == before.location_label_snapshot == "Historical 0 / 9 / old"
        assert item_ids(list_reads(db, data.users["ADMIN"], building="Renamed A")) == [
            data.ids[index] for index in (6, 5, 2, 0)
        ]
        assert list_reads(db, data.users["ADMIN"], building="Current A").items == ()
        assert list_reads(db, data.users["ADMIN"], building="Historical 0").items == ()
        assert item_ids(list_reads(db, data.users["ADMIN"], building="Current B")) == [
            data.ids[index] for index in (7, 4, 3, 1)
        ]


def test_default_twenty_maximum_hundred_limit_plus_one_and_tied_timestamp_seek(read_data):
    data = read_data
    with Session(data.engine, expire_on_commit=False) as setup, setup.begin():
        extra = [Ticket(
            code=f"CF-20261012-{1000 + index:06d}", reporter_id=data.users["REPORTER"].id,
            location_id=data.locations[0].id, location_label_snapshot="fixture snapshot",
            title=f"Tie {index}", description="fixture", category="OTHER_FACILITY", priority=None,
            status="SUBMITTED", current_assignee_id=None, version=1, closed_at=None,
            created_at=STAMP, updated_at=STAMP,
        ) for index in range(103)]
        setup.add_all(extra)
        setup.flush()
        extra_ids = [ticket.id for ticket in reversed(extra)]
    with Session(data.engine) as db, capture_sql(data.engine) as queries:
        default = list_reads(db, data.users["REPORTER"])
        assert len(default.items) == 20 and default.next_cursor is not None
        assert item_ids(default) == [data.ids[7]] + extra_ids[:19]
        largest = list_reads(db, data.users["REPORTER"], limit=100)
        assert len(largest.items) == 100 and largest.next_cursor is not None
        tail = list_reads(db, data.users["REPORTER"], limit=100, cursor=largest.next_cursor)
        assert tail.next_cursor is None
        expected = [data.ids[7]] + extra_ids + [data.ids[index] for index in (6, 5, 4, 2, 0)]
        assert item_ids(largest) + item_ids(tail) == expected
        assert len(set(expected)) == 109
        select_queries = [(sql, parameters) for sql, parameters in queries if "from tickets" in sql.lower()]
        assert select_queries and all("limit" in sql.lower() for sql, _ in select_queries)
        assert any("21" in repr(parameters) for _, parameters in select_queries)
        assert any("101" in repr(parameters) for _, parameters in select_queries)


def test_cursor_scope_rejects_tampering_user_role_filter_or_secret_but_allows_limit_change(read_data):
    data = read_data
    with Session(data.engine) as db:
        first = list_reads(db, data.users["REPORTER"], limit=1)
        assert first.next_cursor is not None
        next_page = list_reads(db, data.users["REPORTER"], limit=3, cursor=first.next_cursor)
        assert item_ids(next_page) == [data.ids[index] for index in (6, 5, 4)]
        cursor = first.next_cursor
        altered = ("B" if cursor[0] != "B" else "C") + cursor[1:]
        role_changed = SimpleNamespace(id=data.users["REPORTER"].id, role="TECHNICIAN", active=True)
        invalid = [
            (data.users["REPORTER"], {"cursor": altered}, SECRET),
            (data.users["OTHER_REPORTER"], {"cursor": cursor}, SECRET),
            (role_changed, {"cursor": cursor}, SECRET),
            (data.users["REPORTER"], {"cursor": cursor, "status": "SUBMITTED"}, SECRET),
            (data.users["REPORTER"], {"cursor": cursor, "building": "Current A"}, SECRET),
            (data.users["REPORTER"], {"cursor": cursor}, SECRET + "different"),
            (data.users["REPORTER"], {"cursor": "not-a-signed-cursor"}, SECRET),
        ]
        for actor, filters, secret in invalid:
            with pytest.raises(AppError) as caught:
                list_ticket_reads(db, actor=actor, filters=TicketListFilters(**filters), secret_key=secret)
            assert_error(caught, 400, "VALIDATION_ERROR")


def test_missing_and_invisible_details_use_identical_404_before_loading_children(read_data):
    data = read_data
    observed = []
    with Session(data.engine) as db:
        for actor, ticket_id in (
            (data.users["REPORTER"], max(data.ids) + 10000),
            (data.users["REPORTER"], data.ids[3]),
            (data.users["OTHER_REPORTER"], data.ids[2]),
            (data.users["OTHER_TECHNICIAN"], data.ids[2]),
            (data.users["TECHNICIAN"], data.ids[0]),
        ):
            with capture_sql(data.engine) as queries, pytest.raises(AppError) as caught:
                get_ticket_read(db, actor=actor, ticket_id=ticket_id)
            assert_error(caught, 404, "NOT_FOUND")
            observed.append((caught.value.status_code, caught.value.code, caught.value.message, caught.value.field_errors))
            joined_sql = " ".join(sql.lower() for sql, _ in queries)
            assert all(table not in joined_sql for table in ("attachments", "assignments", "ticket_events", "comments"))
    assert all(value == observed[0] for value in observed)


def test_details_filter_private_timeline_in_sql_sort_stably_and_isolate_ticket_children(read_data):
    data = read_data
    with Session(data.engine) as db:
        for role in ("REPORTER", "TECHNICIAN", "ADMIN"):
            with capture_sql(data.engine) as queries:
                detail = get_ticket_read(db, actor=data.users[role], ticket_id=data.ids[2])
            expected_comments = data.comments[:3] if role == "ADMIN" else [data.comments[0], data.comments[2]]
            expected_events = data.events[:3] if role == "ADMIN" else [data.events[0], data.events[2]]
            expected = sorted(
                [(row.created_at, "COMMENT", row.id) for row in expected_comments]
                + [(row.created_at, "EVENT", row.id) for row in expected_events]
            )
            assert [(row.created_at, row.kind, row.id) for row in detail.timeline] == expected
            assert all(row.ticket_id == data.ids[2] for row in detail.timeline)
            assert len(detail.assignments) == 1 and detail.assignments[0].id == data.assignments[0].id
            assert [row.id for row in detail.report_photos] == [data.photos[0].id]
            assert [row.id for row in detail.resolution_photos] == [data.photos[1].id]
            assert all(row.purpose == "REPORT_PHOTO" for row in detail.report_photos)
            assert all(row.purpose == "RESOLUTION_PHOTO" for row in detail.resolution_photos)
            if role != "ADMIN":
                assert all(row.visibility == "PUBLIC" for row in detail.timeline)
                for table in ("ticket_events", "comments"):
                    source_queries = [(sql, parameters) for sql, parameters in queries if f"from {table}" in sql.lower()]
                    assert source_queries, f"Expected a real SQL query for {table}."
                    assert all("visibility" in sql.lower() and "PUBLIC" in repr(parameters) for sql, parameters in source_queries)


def test_detached_frozen_safe_dtos_match_public_subcomponent_schemas_without_workflow_claim(read_data, read_contract_registry):
    data = read_data
    with Session(data.engine) as db, capture_sql(data.engine) as queries:
        detail = get_ticket_read(db, actor=data.users["ADMIN"], ticket_id=data.ids[2])
        listing = list_reads(db, data.users["ADMIN"], limit=100)
    payload = detail.model_dump(mode="json")
    assert WORKFLOW_FIELDS.isdisjoint(payload)
    assert isinstance(detail.timeline, tuple) and isinstance(listing.items, tuple)
    assert_component(payload["reporter"], "UserSummary", read_contract_registry)
    assert_component(payload["current_assignee"], "UserSummary", read_contract_registry)
    for field in ("report_photos", "resolution_photos"):
        for photo in payload[field]:
            assert_component(photo, "Attachment", read_contract_registry)
            assert photo["download_url"] == f"/api/attachments/{photo['id']}"
    for assignment in payload["assignments"]:
        assert_component(assignment, "Assignment", read_contract_registry)
    for entry in payload["timeline"]:
        assert_component(entry, "TicketEvent" if entry["kind"] == "EVENT" else "Comment", read_contract_registry)
    forbidden_keys = {"email", "password_hash", "token_hash", "storage_key", "disk_path", "active"}

    def check_keys(value):
        if isinstance(value, dict):
            assert forbidden_keys.isdisjoint(value)
            for nested in value.values():
                check_keys(nested)
        elif isinstance(value, list):
            for nested in value:
                check_keys(nested)

    check_keys(payload)
    check_keys(listing.model_dump(mode="json"))
    selected_sql = " ".join(sql.lower() for sql, _ in queries)
    assert all(column not in selected_sql for column in forbidden_keys)
    with pytest.raises(ValidationError):
        detail.title = "mutated"
    with pytest.raises(ValidationError):
        detail.reporter.name = "mutated"
    assert payload["created_at"].endswith("Z")


def test_reads_use_fresh_column_values_despite_stale_identity_map_for_ticket_and_related_user(read_data):
    data = read_data
    with Session(data.engine, expire_on_commit=False) as stale:
        old_ticket = stale.get(Ticket, data.ids[2])
        old_user = stale.get(User, data.users["REPORTER"].id)
        old_assignee = stale.get(User, data.users["TECHNICIAN"].id)
        assert old_ticket.title == "Fixture title 2"
        old_name = old_user.name
        old_assignee_name = old_assignee.name
        with Session(data.engine) as writer, writer.begin():
            writer.execute(update(Ticket).where(Ticket.id == data.ids[2]).values(title="Fresh database title"))
            writer.execute(update(User).where(User.id == old_user.id).values(name="Fresh database reporter"))
            writer.execute(update(User).where(User.id == old_assignee.id).values(name="Fresh database assignee"))
        assert old_ticket.title == "Fixture title 2" and old_user.name == old_name
        assert old_assignee.name == old_assignee_name
        detail = get_ticket_read(stale, actor=data.users["ADMIN"], ticket_id=data.ids[2])
        matching = next(row for row in list_reads(stale, data.users["ADMIN"], limit=100).items if row.id == data.ids[2])
        assert detail.title == matching.title == "Fresh database title"
        assert detail.reporter.name == matching.reporter.name == "Fresh database reporter"
        assert detail.current_assignee.name == matching.current_assignee.name == "Fresh database assignee"
        assert old_ticket.title == "Fixture title 2" and old_user.name == old_name
        assert old_assignee.name == old_assignee_name


def test_reads_do_not_flush_commit_or_rollback_the_callers_pending_work(read_data, monkeypatch):
    data = read_data
    with Session(data.engine) as db:
        pending = Location(building="Caller pending", floor="1", room_or_area="1", active=True)
        db.add(pending)

        def forbidden(*args, **kwargs):
            raise AssertionError("A read service must not flush, commit or roll back its caller's transaction.")

        with monkeypatch.context() as patch:
            for method in ("flush", "commit", "rollback"):
                patch.setattr(db, method, forbidden)
            detail = get_ticket_read(db, actor=data.users["ADMIN"], ticket_id=data.ids[2])
            listing = list_reads(db, data.users["ADMIN"], limit=100)
            assert detail.id == data.ids[2] and listing.items
            with pytest.raises(AppError) as caught:
                get_ticket_read(db, actor=data.users["REPORTER"], ticket_id=data.ids[3])
            assert_error(caught, 404, "NOT_FOUND")
            assert pending in db.new and pending.id is None
        db.rollback()
    with Session(data.engine) as observer:
        assert observer.scalar(select(Location.id).where(Location.building == "Caller pending")) is None


def test_inactive_or_malformed_actor_fails_closed_before_any_ticket_query(read_data):
    data = read_data
    invalid = [
        SimpleNamespace(id=data.users["ADMIN"].id, role="ADMIN", active=False),
        SimpleNamespace(id=data.users["ADMIN"].id, role="ADMIN", active=1),
        SimpleNamespace(id=True, role="ADMIN", active=True),
        SimpleNamespace(id=0, role="ADMIN", active=True),
        SimpleNamespace(id="1", role="ADMIN", active=True),
        SimpleNamespace(id=2**63, role="ADMIN", active=True),
        SimpleNamespace(id=data.users["ADMIN"].id, role="UNKNOWN", active=True),
        SimpleNamespace(id=data.users["ADMIN"].id, role=None, active=True),
        SimpleNamespace(id=data.users["ADMIN"].id, role=["ADMIN"], active=True),
        SimpleNamespace(id=data.users["ADMIN"].id, role={"role": "ADMIN"}, active=True),
        SimpleNamespace(id=data.users["ADMIN"].id, role=1, active=True),
        None,
    ]
    with Session(data.engine) as db:
        for actor in invalid:
            with capture_sql(data.engine) as queries:
                with pytest.raises(AppError) as listing_error:
                    list_reads(db, actor)
                with pytest.raises(AppError) as detail_error:
                    get_ticket_read(db, actor=actor, ticket_id=data.ids[0])
            assert_error(listing_error, 401, "UNAUTHORIZED")
            assert_error(detail_error, 401, "UNAUTHORIZED")
            assert not queries


def test_approved_keyword_search_is_literal_case_insensitive_contains_on_code_or_title(read_data):
    data = read_data
    titles = (
        "Front AbCd Mixed中文 marker Tail",
        "Hidden AbCd Mixed中文",
        "Literal 50% rate _one slash/a back\\a",
        "Hidden title without special characters",
        "Literal 500 rate Xone slashXa backXa",
        "  padded term  ",
        "SQL quote ' OR 1=1 -- %_ /",
        "Literal normal title",
    )
    with Session(data.engine) as setup, setup.begin():
        for ticket_id, title in zip(data.ids, titles):
            setup.execute(update(Ticket).where(Ticket.id == ticket_id).values(title=title))
    cases = (
        ("aBcD", (0, 1)), ("中文", (0, 1)), ("FrOnT aBc", (0,)),
        ("cf-20261012-000003", (2,)), ("12-000003", (2,)),
        ("50%", (2,)), ("%", (6, 2)), ("_", (6, 2)), ("_one", (2,)),
        ("/a", (2,)), ("/", (6, 2)), ("//", ()),
        ("back\\a", (2,)), ("\\", (2,)), ("\\%", ()),
        (" padded term ", (5,)), ("  ", (5,)), ("   padded term", ()),
        (" padded term   ", ()), ("does-not-exist", ()),
        ("' OR 1=1 -- %_ /", (6,)),
    )
    with Session(data.engine) as db:
        for keyword, indices in cases:
            expected = sorted(indices, key=lambda index: (data.specs[index][-1], data.ids[index]), reverse=True)
            result = list_reads(db, data.users["ADMIN"], q=keyword, limit=100)
            assert item_ids(result) == [data.ids[index] for index in expected], keyword
            assert result.next_cursor is None
        payload = "' OR 1=1 -- %_ /"
        with capture_sql(data.engine) as queries:
            result = list_reads(db, data.users["ADMIN"], q=payload)
        assert item_ids(result) == [data.ids[6]]
        assert queries and all(payload not in sql for sql, _ in queries)
        assert any("OR 1=1" in repr(parameters) for _, parameters in queries)


def test_keyword_or_cannot_bypass_visibility_or_other_and_filters(read_data):
    data = read_data
    expected = {
        "REPORTER": (7, 6, 5, 4, 2, 0),
        "OTHER_REPORTER": (3, 1),
        "TECHNICIAN": (7, 4, 3, 2),
        "OTHER_TECHNICIAN": (5,),
        "ADMIN": (7, 6, 5, 4, 3, 2, 0, 1),
    }
    with Session(data.engine) as db:
        for role, indices in expected.items():
            assert item_ids(list_reads(db, data.users[role], q="cF-", limit=100)) == [
                data.ids[index] for index in indices
            ]
        for keyword in ("Fixture title 3", "CF-20261012-000004"):
            assert list_reads(db, data.users["REPORTER"], q=keyword).items == ()
        filters = dict(
            status="ASSIGNED", category="LIGHTING_ELECTRICAL", priority="HIGH", building="Current A",
            created_from=STAMP, created_before=STAMP + timedelta(seconds=1),
            current_assignee_id=data.users["TECHNICIAN"].id,
        )
        assert item_ids(list_reads(db, data.users["ADMIN"], q="cF-", **filters)) == [data.ids[2]]
        for keyword in ("Fixture title 3", "CF-20261012-000004", "does-not-exist"):
            assert list_reads(db, data.users["ADMIN"], q=keyword, **filters).items == ()


def test_keyword_filter_is_bound_to_cursor_and_visibility_scope(read_data):
    data = read_data
    with Session(data.engine) as db:
        first = list_reads(db, data.users["REPORTER"], q="FiXtUrE", limit=1)
        assert item_ids(first) == [data.ids[7]] and first.next_cursor is not None
        following = list_reads(
            db, data.users["REPORTER"], q="FiXtUrE", limit=3, cursor=first.next_cursor,
        )
        assert item_ids(following) == [data.ids[index] for index in (6, 5, 4)]
        for actor, keyword in (
            (data.users["REPORTER"], "title 0"),
            (data.users["REPORTER"], None),
            (data.users["OTHER_REPORTER"], "FiXtUrE"),
        ):
            with pytest.raises(AppError) as caught:
                list_reads(db, actor, q=keyword, limit=3, cursor=first.next_cursor)
            assert_error(caught, 400, "VALIDATION_ERROR")


def test_unvalidated_internal_arguments_and_empty_signing_secret_are_rejected_before_sql(read_data):
    data = read_data
    with Session(data.engine) as db, capture_sql(data.engine) as queries:
        for value in (True, False, 0, -1, "1", 1.0, 2**63, None):
            with pytest.raises(ValueError):
                get_ticket_read(db, actor=data.users["ADMIN"], ticket_id=value)
        for filters in (
            TicketListFilters.model_construct(limit=101),
            TicketListFilters().model_copy(update={"limit": 0}),
            TicketListFilters().model_copy(update={"current_assignee_id": True}),
        ):
            with pytest.raises(ValidationError):
                list_ticket_reads(db, actor=data.users["ADMIN"], filters=filters, secret_key=SECRET)
        with pytest.raises(ValueError):
            list_ticket_reads(db, actor=data.users["ADMIN"], filters=TicketListFilters(), secret_key="")
    assert not queries
