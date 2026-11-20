"""Issue #51 creation through real HTTP, migrated PostgreSQL and private files.

These checks cover backend use cases, not browser E2E or the separate #54
download/comments endpoints. No substitute business routes or auth stubs run.
"""

import importlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.models import Attachment, Location, Session as AuthSession, Ticket, TicketEvent, User
from app.modules.tickets.reads import list_ticket_reads
from app.modules.tickets.schemas import TicketListFilters
from test_workflow_api import (
    HEADERS, ORIGIN, assert_schema, contract_registry, login, pg_engine, png_bytes,
)  # noqa: F401 -- use the existing disposable migration and contract fixtures


@pytest.fixture
def creation_app(pg_engine, monkeypatch, tmp_path):
    settings = Settings(
        _env_file=None, secret_key="creation-test-secret-" + "x" * 32,
        allowed_origins=[ORIGIN], environment="test",
        attachment_storage_path=tmp_path / "private-attachments",
    )
    main = importlib.import_module("app.main")
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    app = main.create_app()
    app.dependency_overrides[get_settings] = lambda: settings

    def test_db():
        with Session(pg_engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    with Session(pg_engine) as db:
        location = db.scalar(select(Location).where(Location.active.is_(True)).order_by(Location.id))
        location_id = location.id
        snapshot = f"{location.building} / {location.floor} / {location.room_or_area}"
    return SimpleNamespace(
        app=app, engine=pg_engine, storage=settings.attachment_storage_path,
        location_id=location_id, snapshot=snapshot,
    )


def fields(data, **changes):
    return {
        "title": "教室照明闪烁", "description": "灯具持续闪烁，请安排检查。",
        "category": "LIGHTING_ELECTRICAL", "location_id": str(data.location_id),
        **changes,
    }


def submit(client, payload, photos=(), headers=HEADERS):
    # Multipart is required even when photos are omitted.
    parts = [(name, (None, value)) for name, value in payload.items()]
    parts.extend(("photos", photo) for photo in photos)
    return client.post("/api/tickets", files=parts, headers=headers)


def assert_empty(data):
    with Session(data.engine) as db:
        for model in (Ticket, TicketEvent, Attachment):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    assert not data.storage.exists() or not list(data.storage.iterdir())


@pytest.mark.parametrize("with_photo", (False, True))
def test_real_create_detail_cancel_chain_preserves_submission_and_photo(creation_app, contract_registry, with_photo):
    data = creation_app
    client = login(data.app, "REPORTER")
    content = png_bytes()
    response = submit(client, fields(data), [("original-name.png", content, "image/png")] if with_photo else [])
    assert response.status_code == 201, response.text
    assert_schema(response, "TicketSummary", contract_registry)
    ticket = response.json()
    ticket_id = ticket["id"]
    assert response.headers["location"] == f"/api/tickets/{ticket_id}"
    assert ticket["code"].endswith(f"-{ticket_id:06d}")
    assert ticket["location_label_snapshot"] == data.snapshot
    assert (ticket["status"], ticket["version"]) == ("SUBMITTED", 1)
    assert ticket["priority"] is ticket["current_assignee"] is ticket["closed_at"] is None
    assert ticket["current_responsible_role"] == "ADMIN"
    assert ticket["next_action"] == "REVIEW"
    assert ticket["allowed_actions"] == ["CANCEL", "COMMENT_PUBLIC"]
    detail = client.get(response.headers["location"])
    assert detail.status_code == 200, detail.text
    assert_schema(detail, "TicketDetail", contract_registry)
    assert len(detail.json()["report_photos"]) == int(with_photo)
    assert detail.json()["resolution_photos"] == []
    timeline = detail.json()["timeline"]
    assert len(timeline) == 1
    assert (timeline[0]["type"], timeline[0]["from_status"], timeline[0]["to_status"], timeline[0]["visibility"]) == (
        "TICKET_SUBMITTED", None, "SUBMITTED", "PUBLIC",
    )
    with Session(data.engine) as db:
        photos = db.scalars(select(Attachment).where(Attachment.ticket_id == ticket_id)).all()
        assert len(photos) == int(with_photo)
        if with_photo:
            photo = photos[0]
            assert (photo.purpose, photo.original_name, photo.mime, photo.size) == (
                "REPORT_PHOTO", "original-name.png", "image/png", len(content),
            )
            assert photo.storage_key != photo.original_name
            assert (data.storage / photo.storage_key).read_bytes() == content
            public_photo = detail.json()["report_photos"][0]
            assert public_photo["download_url"] == f"/api/attachments/{photo.id}"
            assert "storage_key" not in public_photo
    cancelled = client.post(
        f"/api/tickets/{ticket_id}/cancel", json={"expected_version": 1}, headers=HEADERS,
    )
    assert cancelled.status_code == 200, cancelled.text
    final = client.get(f"/api/tickets/{ticket_id}")
    assert_schema(final, "TicketDetail", contract_registry)
    assert (final.json()["status"], final.json()["version"], final.json()["allowed_actions"]) == ("CANCELLED", 2, [])
    assert [entry["type"] for entry in final.json()["timeline"]] == ["TICKET_SUBMITTED", "TICKET_CANCELLED"]


def test_creation_uses_shanghai_calendar_date_and_database_identity(creation_app, monkeypatch):
    data = creation_app
    creation = importlib.import_module("app.modules.tickets.creation")
    clock = [datetime(2026, 10, 22, 15, 59, 59, tzinfo=timezone.utc)]

    monkeypatch.setattr(creation, "_now_utc", lambda: clock[0])
    client = login(data.app, "REPORTER")
    before = submit(client, fields(data))
    clock[0] = datetime(2026, 10, 22, 16, 0, 0, tzinfo=timezone.utc)
    after = submit(client, fields(data))
    assert before.status_code == after.status_code == 201
    assert before.json()["code"] == f"CF-20261022-{before.json()['id']:06d}"
    assert after.json()["code"] == f"CF-20261023-{after.json()['id']:06d}"
    assert before.json()["id"] != after.json()["id"]


def test_concurrent_creations_allocate_distinct_ids_and_one_event_each(creation_app):
    data = creation_app
    authenticated = login(data.app, "REPORTER")
    cookies = dict(authenticated.cookies)
    barrier = Barrier(4)

    def create(index):
        with TestClient(data.app, cookies=cookies) as client:
            barrier.wait(timeout=15)
            return submit(client, fields(data, title=f"Concurrent report {index}"))

    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(create, range(4)))
    assert [result.status_code for result in results] == [201] * 4
    ids = [result.json()["id"] for result in results]
    codes = [result.json()["code"] for result in results]
    assert len(set(ids)) == len(set(codes)) == 4
    assert all(code.endswith(f"-{ticket_id:06d}") for ticket_id, code in zip(ids, codes))
    with Session(data.engine) as db:
        assert db.scalar(select(func.count()).select_from(Ticket)) == 4
        assert db.scalar(select(func.count()).select_from(TicketEvent)) == 4


def test_required_lengths_enums_extra_fields_and_non_multipart_do_not_write(creation_app, contract_registry):
    data = creation_app
    client = login(data.app, "REPORTER")
    valid = fields(data)
    cases = [{key: value for key, value in valid.items() if key != missing} for missing in valid]
    cases.extend([
        {**valid, "title": ""}, {**valid, "title": "x" * 121},
        {**valid, "description": ""}, {**valid, "description": "x" * 4001},
        {**valid, "category": "UNKNOWN"}, {**valid, "location_id": "0"},
        {**valid, "location_id": "1.5"}, {**valid, "location_id": str(2**63)},
        {**valid, "status": "CLOSED"}, {**valid, "reporter_id": "999"},
    ])
    for payload in cases:
        response = submit(client, payload)
        assert response.status_code == 422, response.text
        assert_schema(response, "ErrorResponse", contract_registry)
    json_response = client.post("/api/tickets", json=valid, headers=HEADERS)
    assert json_response.status_code == 422
    assert_empty(data)


def test_creation_auth_role_and_origin_fail_without_writes(creation_app, contract_registry):
    data = creation_app
    anonymous = submit(TestClient(data.app), fields(data))
    assert anonymous.status_code == 401
    assert_schema(anonymous, "ErrorResponse", contract_registry)
    for role in ("ADMIN", "TECHNICIAN"):
        denied = submit(login(data.app, role), fields(data))
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "FORBIDDEN"
    reporter = login(data.app, "REPORTER")
    for headers in ({}, {"Origin": "https://attacker.example.invalid"}):
        denied = submit(reporter, fields(data), headers=headers)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"
    assert_empty(data)


def test_disabled_and_expired_reporter_sessions_cannot_create(creation_app):
    data = creation_app
    reporter = login(data.app, "REPORTER")
    with Session(data.engine) as db, db.begin():
        db.execute(update(AuthSession).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    assert submit(reporter, fields(data)).status_code == 401
    reporter = login(data.app, "REPORTER")
    with Session(data.engine) as db, db.begin():
        db.execute(update(User).where(User.role == "REPORTER").values(active=False))
    assert submit(reporter, fields(data)).status_code == 401
    assert_empty(data)


def test_missing_or_disabled_location_rejects_and_cleans_prepared_photos(creation_app, contract_registry):
    data = creation_app
    client = login(data.app, "REPORTER")
    photo = [("report.png", png_bytes(), "image/png")]
    missing = submit(client, fields(data, location_id=str(2**63 - 1)), photo)
    assert missing.status_code == 422, missing.text
    assert_schema(missing, "ErrorResponse", contract_registry)
    assert_empty(data)
    with Session(data.engine) as db, db.begin():
        db.execute(update(Location).where(Location.id == data.location_id).values(active=False))
    inactive = submit(client, fields(data), photo)
    assert inactive.status_code == 409, inactive.text
    assert_schema(inactive, "ErrorResponse", contract_registry)
    assert_empty(data)


def test_upload_rejections_leave_no_ticket_event_metadata_or_file(creation_app, contract_registry):
    data = creation_app
    client = login(data.app, "REPORTER")
    good = ("report.png", png_bytes(), "image/png")
    cases = [
        ([good] * 6, 422),
        ([("too-big.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")], 413),
        ([("vector.svg", b"<svg></svg>", "image/svg+xml")], 415),
        ([("pretend.jpg", png_bytes(), "image/jpeg")], 415),
        ([("broken.png", b"not an image", "image/png")], 422),
        ([good, ("broken.png", b"not an image", "image/png")], 422),
    ]
    for photos, expected_status in cases:
        response = submit(client, fields(data), photos)
        assert response.status_code == expected_status, response.text
        assert_schema(response, "ErrorResponse", contract_registry)
        assert_empty(data)


def test_five_report_photos_are_stored_separately_from_result_photos(creation_app):
    data = creation_app
    client = login(data.app, "REPORTER")
    photo = ("same-name.png", png_bytes(), "image/png")
    response = submit(client, fields(data), [photo] * 5)
    assert response.status_code == 201, response.text
    detail = client.get(response.headers["location"]).json()
    assert len(detail["report_photos"]) == 5
    assert detail["resolution_photos"] == []
    with Session(data.engine) as db:
        rows = db.scalars(select(Attachment)).all()
        assert len({row.storage_key for row in rows}) == 5
        assert {row.purpose for row in rows} == {"REPORT_PHOTO"}
        assert all((data.storage / row.storage_key).read_bytes() == photo[1] for row in rows)


@pytest.mark.parametrize("phase", ("metadata", "publish", "commit"))
def test_creation_transaction_failures_roll_back_all_rows_and_private_files(creation_app, monkeypatch, phase):
    data = creation_app
    creation = importlib.import_module("app.modules.tickets.creation")
    authenticated = login(data.app, "REPORTER")

    def fail(*args, **kwargs):
        raise RuntimeError("private fixture failure")

    if phase == "metadata":
        monkeypatch.setattr(creation, "stage_photos", fail)
    elif phase == "publish":
        attachments = importlib.import_module("app.modules.attachments.service")
        original_replace = attachments.os.replace
        moved = []

        def fail_second_move(source, target):
            if moved:
                raise OSError("private move failure")
            original_replace(source, target)
            moved.append(target)

        monkeypatch.setattr(attachments.os, "replace", fail_second_move)
    else:
        def failing_db():
            with Session(data.engine) as db:
                monkeypatch.setattr(db, "commit", fail)
                yield db

        data.app.dependency_overrides[get_db] = failing_db
    with TestClient(data.app, cookies=dict(authenticated.cookies), raise_server_exceptions=False) as client:
        good = ("report.png", png_bytes(), "image/png")
        response = submit(client, fields(data), [good, good])
    assert response.status_code == 500, response.text
    assert "private" not in response.text
    assert_empty(data)


def test_real_creation_snapshot_survives_location_rename_and_disable(creation_app, contract_registry):
    data = creation_app
    reporter = login(data.app, "REPORTER")
    created = submit(reporter, fields(data))
    assert created.status_code == 201, created.text
    admin = login(data.app, "ADMIN")
    changed = admin.patch(
        f"/api/admin/locations/{data.location_id}",
        json={"building": "Renamed after ticket creation", "active": False}, headers=HEADERS,
    )
    assert changed.status_code == 200, changed.text
    detail = reporter.get(created.headers["location"])
    assert detail.status_code == 200
    assert_schema(detail, "TicketDetail", contract_registry)
    assert detail.json()["location_label_snapshot"] == created.json()["location_label_snapshot"] == data.snapshot


def test_photo_validation_finishes_before_business_transaction_and_location_lock(creation_app, monkeypatch):
    data = creation_app
    creation = importlib.import_module("app.modules.tickets.creation")
    original_create = creation.create_ticket
    original_prepare = creation.prepare_photos
    original_select = creation.select_location_for_ticket
    order = []

    def checked_create(db, **kwargs):
        assert not db.in_transaction(), "Uploads must not retain the business database transaction."
        return original_create(db, **kwargs)

    def checked_prepare(*args, **kwargs):
        prepared = original_prepare(*args, **kwargs)
        order.append("photos_validated")
        return prepared

    def checked_select(*args, **kwargs):
        assert order == ["photos_validated"]
        order.append("location_locked")
        return original_select(*args, **kwargs)

    monkeypatch.setattr(creation, "create_ticket", checked_create)
    monkeypatch.setattr(creation, "prepare_photos", checked_prepare)
    monkeypatch.setattr(creation, "select_location_for_ticket", checked_select)
    client = login(data.app, "REPORTER")
    result = submit(client, fields(data), [("report.png", png_bytes(), "image/png")])
    assert result.status_code == 201, result.text
    assert order == ["photos_validated", "location_locked"]


def test_valid_urlencoded_fields_are_rejected_without_creating_a_ticket(creation_app, contract_registry):
    data = creation_app
    reporter = login(data.app, "REPORTER")
    response = reporter.post("/api/tickets", data=fields(data), headers=HEADERS)
    assert response.status_code == 415, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert_schema(response, "ErrorResponse", contract_registry)
    assert_empty(data)


def test_truncated_jpeg_that_passes_verify_but_cannot_decode_is_rejected(creation_app, contract_registry):
    data = creation_app
    output = BytesIO()
    Image.new("RGB", (32, 32), "red").save(output, format="JPEG")
    truncated = output.getvalue()[:-2]
    # JPEG's verify() does not decode pixels; this fixture distinguishes the
    # required decodability check from a header-only validation.
    with Image.open(BytesIO(truncated)) as image:
        image.verify()
    with Image.open(BytesIO(truncated)) as image, pytest.raises(OSError):
        image.load()
    reporter = login(data.app, "REPORTER")
    response = submit(reporter, fields(data), [("truncated.jpg", truncated, "image/jpeg")])
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert_schema(response, "ErrorResponse", contract_registry)
    assert_empty(data)


def test_commit_and_rollback_failures_still_remove_prepared_and_published_files(creation_app, monkeypatch):
    data = creation_app
    authenticated = login(data.app, "REPORTER")

    def failing_db():
        with Session(data.engine) as db:
            real_rollback = db.rollback

            def fail_commit():
                raise RuntimeError("private fixture commit failure")

            def rollback_then_fail():
                real_rollback()
                raise RuntimeError("private fixture rollback failure")

            monkeypatch.setattr(db, "commit", fail_commit)
            monkeypatch.setattr(db, "rollback", rollback_then_fail)
            yield db

    data.app.dependency_overrides[get_db] = failing_db
    with TestClient(data.app, cookies=dict(authenticated.cookies), raise_server_exceptions=False) as client:
        photo = ("report.png", png_bytes(), "image/png")
        response = submit(client, fields(data), [photo, photo])
    assert response.status_code == 500, response.text
    assert "private" not in response.text
    assert_empty(data)


def test_real_creation_ownership_scopes_detail_and_internal_list_reads(creation_app):
    """Create via HTTP, then verify detail and the internal (not HTTP) list."""
    data = creation_app
    reporter_a = login(data.app, "REPORTER")
    token_b = "second-reporter-creation-fixture-token"
    with Session(data.engine) as db, db.begin():
        second = User(
            name="Second creation reporter", email="creation-b@example.invalid",
            password_hash="unused-fixture-password-hash", role="REPORTER", active=True,
        )
        db.add(second)
        db.flush()
        db.add(AuthSession(
            user_id=second.id, token_hash=hash_session_token(token_b),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        ))
    reporter_b = TestClient(data.app)
    reporter_b.cookies.set(SESSION_COOKIE_NAME, token_b)
    created_a = submit(reporter_a, fields(data, title="Reporter A's real report"))
    created_b = submit(reporter_b, fields(data, title="Reporter B's real report"))
    assert created_a.status_code == created_b.status_code == 201
    ticket_a, ticket_b = created_a.json(), created_b.json()
    assert ticket_a["id"] != ticket_b["id"]
    for client, other in ((reporter_a, ticket_b), (reporter_b, ticket_a)):
        denied = client.get(f"/api/tickets/{other['id']}")
        assert denied.status_code == 404
        assert denied.json()["error"]["code"] == "NOT_FOUND"
    with Session(data.engine) as db:
        for ticket in (ticket_a, ticket_b):
            actor = db.get(User, ticket["reporter"]["id"])
            page = list_ticket_reads(
                db, actor=actor, filters=TicketListFilters(),
                secret_key="created-visibility-fixture-only-" + "x" * 32,
            )
            assert [item.id for item in page.items] == [ticket["id"]]
            assert page.next_cursor is None


def test_jpeg_png_and_webp_are_stored_with_verified_mime_size_and_private_bytes(creation_app):
    data = creation_app
    uploads = []
    expected = {}
    for image_format, extension, mime in (
        ("JPEG", "jpg", "image/jpeg"),
        ("PNG", "png", "image/png"),
        ("WEBP", "webp", "image/webp"),
    ):
        output = BytesIO()
        Image.new("RGB", (3, 3), "red").save(output, format=image_format)
        content = output.getvalue()
        name = f"report.{extension}"
        uploads.append((name, content, mime))
        expected[name] = (content, mime)
    reporter = login(data.app, "REPORTER")
    created = submit(reporter, fields(data), uploads)
    assert created.status_code == 201, created.text
    detail = reporter.get(created.headers["location"])
    assert detail.status_code == 200
    assert {photo["mime"] for photo in detail.json()["report_photos"]} == {
        "image/jpeg", "image/png", "image/webp",
    }
    with Session(data.engine) as db:
        rows = db.scalars(select(Attachment).where(Attachment.ticket_id == created.json()["id"])).all()
        assert len(rows) == 3
        assert {row.purpose for row in rows} == {"REPORT_PHOTO"}
        for row in rows:
            content, mime = expected[row.original_name]
            assert row.mime == mime
            assert row.size == len(content)
            assert row.storage_key != row.original_name
            assert (data.storage / row.storage_key).read_bytes() == content
