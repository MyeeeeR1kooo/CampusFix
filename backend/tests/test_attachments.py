"""#54 reuses the live #51/#50 helpers, routes and disposable PostgreSQL."""

import importlib
import io
import os
import struct
import subprocess
import sys
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers, UploadFile

from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import hash_password
from app.models import Attachment, Session as AuthSession, Ticket, User
from app.modules.attachments.cleanup import cleanup_orphans
from app.modules.attachments.service import (
    MAX_BYTES, discard_photos, prepare_photos, publish_photos, stage_photos,
)
from app.modules.attachments.storage import AttachmentStore, STORAGE_KEY
from test_ticket_creation_api import creation_app, fields, submit  # noqa: F401
from test_workflow_api import (  # noqa: F401
    HEADERS, ORIGIN, assigned_ticket, assert_schema, contract_registry, login,
    pg_engine, png_bytes, ticket_fixture,
)


def picture(image_format="PNG", *, animated=False):
    stream = io.BytesIO()
    image = Image.new("RGB", (4, 4), "red")
    options = {"save_all": True, "append_images": [Image.new("RGB", (4, 4), "blue")], "duration": 100} if animated else {}
    image.save(stream, format=image_format, **options)
    return stream.getvalue()


def upload(body=None, mime="image/png", name="照片.png"):
    return UploadFile(io.BytesIO(picture() if body is None else body), filename=name,
                      headers=Headers({"content-type": mime}))


def disk_files(path):
    return list(path.iterdir()) if path.exists() else []


@pytest.mark.parametrize(("image_format", "mime"), [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")])
def test_shared_preparation_decodes_content_and_uses_random_names(tmp_path, image_format, mime):
    body = picture(image_format)
    source = upload(body, mime, "../../untrusted.svg")
    prepared = prepare_photos([source], tmp_path)
    try:
        photo = prepared[0]
        assert (photo.mime, photo.size, photo.original_name) == (mime, len(body), "../../untrusted.svg")
        assert STORAGE_KEY.fullmatch(photo.storage_key) and len(photo.storage_key) == 32
        assert photo.final_path == tmp_path / photo.storage_key
        assert not photo.final_path.exists()
        assert photo.temporary_path.stat().st_mode & 0o777 == 0o600
        assert photo.temporary_path.read_bytes() == body
    finally:
        discard_photos(prepared)
    assert not source.file.closed
    assert disk_files(tmp_path) == []


@pytest.mark.parametrize(("body", "mime", "status"), [
    (b"not an image", "image/png", 422), (b"", "image/png", 422),
    (b"<svg/>", "image/svg+xml", 415), (b"<svg/>", "image/png", 422),
    (picture("GIF"), "image/png", 415), (picture(), "image/jpeg", 415),
    (b"\xff\xd8\xff", "image/jpeg", 422), (b"\x89PNG\r\n\x1a\n", "image/png", 422),
    (b"RIFFxxxxWEBP", "image/webp", 422),
])
def test_fake_mime_and_corrupt_images_are_rejected_without_files(tmp_path, body, mime, status):
    with pytest.raises(AppError) as caught:
        prepare_photos([upload(body, mime)], tmp_path)
    assert (caught.value.status_code, caught.value.code) == (status, "VALIDATION_ERROR")
    assert disk_files(tmp_path) == []


@pytest.mark.parametrize("image_format", ["PNG", "WEBP"])
def test_all_frames_of_supported_images_are_decodable(tmp_path, image_format):
    prepared = prepare_photos([upload(picture(image_format, animated=True), "image/" + image_format.lower())], tmp_path)
    discard_photos(prepared)
    assert disk_files(tmp_path) == []


def test_corrupt_later_frame_is_not_hidden_by_a_valid_first_frame(tmp_path):
    data = bytearray(picture(animated=True))
    position = 8
    while position < len(data):
        size = struct.unpack(">I", data[position:position + 4])[0]
        if data[position + 4:position + 8] == b"fdAT":
            data[position + 12] ^= 0xFF
            crc = zlib.crc32(data[position + 4:position + 8 + size])
            data[position + 8 + size:position + 12 + size] = struct.pack(">I", crc)
            break
        position += size + 12
    else:
        pytest.fail("fixture must include a later frame")
    with pytest.raises(AppError) as caught:
        prepare_photos([upload(bytes(data))], tmp_path)
    assert caught.value.status_code == 422
    assert disk_files(tmp_path) == []


def test_decoder_resource_guard_is_preserved(tmp_path, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 4)
    with pytest.raises(AppError) as caught:
        prepare_photos([upload()], tmp_path)
    assert caught.value.status_code == 422
    assert disk_files(tmp_path) == []


@pytest.mark.parametrize(("extra", "status"), [(0, None), (1, 413)])
def test_exact_five_mib_boundary(tmp_path, extra, status):
    content = picture()
    content += b"\0" * (MAX_BYTES - len(content) + extra)
    if status:
        with pytest.raises(AppError) as caught:
            prepare_photos([upload(content)], tmp_path)
        assert caught.value.status_code == status
    else:
        prepared = prepare_photos([upload(content)], tmp_path)
        assert prepared[0].size == MAX_BYTES
        discard_photos(prepared)
    assert disk_files(tmp_path) == []


def test_invalid_later_image_and_read_error_cleanup_previous_files(tmp_path):
    with pytest.raises(AppError):
        prepare_photos([upload(), upload(b"bad")], tmp_path)
    assert disk_files(tmp_path) == []

    class BrokenReader(io.BytesIO):
        def read(self, size):
            raise OSError("fixture stream failure")

    broken = upload()
    broken.file = BrokenReader()
    with pytest.raises(OSError):
        prepare_photos([upload(), broken], tmp_path)
    assert disk_files(tmp_path) == []


def test_six_images_are_rejected_before_writing(tmp_path):
    with pytest.raises(AppError) as caught:
        prepare_photos([upload() for _ in range(6)], tmp_path)
    assert caught.value.status_code == 422
    assert disk_files(tmp_path) == []


def test_publication_does_not_overwrite_an_existing_key(tmp_path):
    prepared = prepare_photos([upload()], tmp_path)
    prepared[0].final_path.write_bytes(b"existing unrelated file")
    with pytest.raises(FileExistsError):
        publish_photos(prepared)
    assert prepared[0].final_path.read_bytes() == b"existing unrelated file"
    assert not prepared[0].temporary_path.exists()


def test_shared_helper_serializes_per_purpose_limit(tmp_path, pg_engine):
    ticket_id = ticket_fixture(pg_engine)
    barrier = Barrier(2)

    def attempt():
        prepared = prepare_photos([upload() for _ in range(3)], tmp_path)
        published = []
        try:
            barrier.wait(timeout=10)
            with Session(pg_engine) as db, db.begin():
                stage_photos(db, ticket_id, 1, prepared, purpose="REPORT_PHOTO")
                db.flush()
                published = publish_photos(prepared)
            return 200
        except AppError as error:
            return error.status_code
        finally:
            discard_photos(prepared, published)

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: attempt(), range(2))) == [200, 422]
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Attachment)) == 3
    assert len(disk_files(tmp_path)) == 3
    # Resolution photos have their own allowance.
    prepared = prepare_photos([upload() for _ in range(5)], tmp_path)
    with Session(pg_engine) as db, db.begin():
        stage_photos(db, ticket_id, 2, prepared)  # preserve existing default purpose
        db.flush()
        publish_photos(prepared)
    assert len(disk_files(tmp_path)) == 8


def test_post_commit_notification_error_cannot_delete_durable_files(tmp_path, pg_engine):
    ticket_id = ticket_fixture(pg_engine)
    prepared = prepare_photos([upload()], tmp_path)
    published = []

    def failed_notification(db):
        raise RuntimeError("fixture post-commit failure")

    with Session(pg_engine) as db:
        event.listen(db, "after_commit", failed_notification)
        with pytest.raises(RuntimeError):
            stage_photos(db, ticket_id, 1, prepared, purpose="REPORT_PHOTO")
            db.flush()
            published = publish_photos(prepared)
            db.commit()
    discard_photos(prepared, published)
    assert prepared[0].final_path.read_bytes() == picture()
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Attachment)) == 1


def test_two_batches_in_a_core_autoflush_disabled_transaction_share_the_limit(tmp_path, pg_engine):
    ticket_id = ticket_fixture(pg_engine)
    first = prepare_photos([upload() for _ in range(3)], tmp_path)
    second = prepare_photos([upload() for _ in range(3)], tmp_path)
    try:
        with pytest.raises(AppError) as caught:
            with Session(pg_engine, autoflush=False) as db, db.begin():
                stage_photos(db, ticket_id, 1, first, purpose="REPORT_PHOTO")
                stage_photos(db, ticket_id, 1, second, purpose="REPORT_PHOTO")
        assert caught.value.status_code == 422
    finally:
        discard_photos(first + second)
    with Session(pg_engine) as db:
        assert db.scalar(select(func.count()).select_from(Attachment)) == 0
    assert disk_files(tmp_path) == []


def created_photo(data, *, name="report.png"):
    client = login(data.app, "REPORTER")
    response = submit(client, fields(data), [(name, png_bytes(), "image/png")])
    assert response.status_code == 201, response.text
    detail = client.get(f"/api/tickets/{response.json()['id']}").json()
    return client, detail, detail["report_photos"][0]


@pytest.mark.parametrize("role", ["REPORTER", "ADMIN"])
def test_real_creation_downloads_opaque_shared_keys(creation_app, role):
    data = creation_app
    _, detail, photo = created_photo(data)
    response = login(data.app, role).get(photo["download_url"])
    assert response.status_code == 200 and response.content == png_bytes()
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    with Session(data.engine) as db:
        key = db.get(Attachment, photo["id"]).storage_key
        assert len(key) == 32 and (data.storage / key).exists()


def test_missing_unrelated_and_anonymous_downloads(creation_app, contract_registry):
    data = creation_app
    _, _, photo = created_photo(data)
    denied = login(data.app, "TECHNICIAN").get(photo["download_url"])
    missing = login(data.app, "TECHNICIAN").get("/api/attachments/9223372036854775807")
    for response in [denied, missing]:
        assert response.status_code == 404
        assert_schema(response, "ErrorResponse", contract_registry)
    def without_request_id(response):
        return {k: v for k, v in response.json()["error"].items() if k != "request_id"}
    assert without_request_id(denied) == without_request_id(missing)
    assert TestClient(data.app).get(photo["download_url"]).status_code == 401


@pytest.mark.parametrize("role", ["REPORTER", "TECHNICIAN"])
def test_another_person_of_the_same_role_cannot_download(creation_app, role):
    data = creation_app
    _, _, photo = created_photo(data)
    email = uuid4().hex + "@example.invalid"
    with Session(data.engine) as db, db.begin():
        db.add(User(name="虚构无关用户", email=email, role=role,
                    password_hash=hash_password("fixture-only-password")))
    client = TestClient(data.app)
    signed_in = client.post("/api/auth/login", headers=HEADERS,
                            json={"email": email, "password": "fixture-only-password"})
    assert signed_in.status_code == 200
    assert client.get(photo["download_url"]).status_code == 404


def test_download_rechecks_disabled_and_expired_sessions(creation_app):
    data = creation_app
    client, _, photo = created_photo(data)
    with Session(data.engine) as db, db.begin():
        db.get(User, 1).active = False
    assert client.get(photo["download_url"]).status_code == 401
    with Session(data.engine) as db, db.begin():
        db.get(User, 1).active = True
        for session in db.scalars(select(AuthSession)):
            session.expires_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
    assert client.get(photo["download_url"]).status_code == 401


@pytest.mark.parametrize("kind", ["missing", "symlink", "directory", "traversal"])
def test_private_download_does_not_follow_paths_or_links(creation_app, tmp_path, kind):
    data = creation_app
    client, _, photo = created_photo(data)
    with Session(data.engine) as db:
        key = db.get(Attachment, photo["id"]).storage_key
    path = data.storage / key
    path.unlink()
    outside = tmp_path / "private-unrelated.txt"
    outside.write_bytes(b"not a photo")
    if kind == "symlink":
        path.symlink_to(outside)
    elif kind == "directory":
        path.mkdir()
    elif kind == "traversal":
        with Session(data.engine) as db, db.begin():
            db.get(Attachment, photo["id"]).storage_key = "../private-unrelated.txt"
    assert client.get(photo["download_url"]).status_code == 404
    assert client.get("/data/attachments/" + key).status_code == 404
    assert outside.read_bytes() == b"not a photo"


def test_filename_header_is_safe_and_stream_closes(creation_app, monkeypatch):
    data = creation_app
    client, _, photo = created_photo(data)
    with Session(data.engine) as db, db.begin():
        db.get(Attachment, photo["id"]).original_name = "照片\r\nX-Injected: yes.png"
    opened = []
    original = AttachmentStore.open

    def capture(self, key):
        stream = original(self, key)
        opened.append(stream)
        return stream

    monkeypatch.setattr(AttachmentStore, "open", capture)
    response = client.get(photo["download_url"])
    assert response.status_code == 200
    assert "%0D%0AX-Injected%3A%20yes.png" in response.headers["content-disposition"]
    assert "x-injected" not in response.headers
    assert opened and all(stream.closed for stream in opened)
    assert client.post("/api/attachments", headers=HEADERS).status_code == 404


def test_orphan_cleanup_age_reference_and_symlink_boundaries(creation_app):
    data = creation_app
    _, _, photo = created_photo(data)
    with Session(data.engine) as db:
        key = db.get(Attachment, photo["id"]).storage_key
    now = datetime.now(timezone.utc)
    old = (now - timedelta(hours=25)).timestamp()
    exact = (now - timedelta(hours=24)).timestamp()
    orphan, recent, boundary = [data.storage / uuid4().hex for _ in range(3)]
    temporary = data.storage / ".upload-old_file"
    unknown = data.storage / "unmanaged.txt"
    for path in [orphan, recent, boundary, temporary, unknown]:
        path.write_bytes(b"fixture")
    link = data.storage / uuid4().hex
    link.symlink_to(unknown)
    for path in [orphan, temporary, unknown, data.storage / key]:
        os.utime(path, (old, old))
    os.utime(boundary, (exact, exact))
    with Session(data.engine) as db:
        assert cleanup_orphans(db, AttachmentStore(data.storage), now=now) == 2
        assert cleanup_orphans(db, AttachmentStore(data.storage), now=now) == 0
        assert db.get(Attachment, photo["id"]) is not None
    assert not orphan.exists() and not temporary.exists()
    assert all(path.exists() for path in [recent, boundary, unknown, data.storage / key])
    assert link.is_symlink()


def test_maintenance_cannot_delete_a_fresh_publication_of_an_old_upload(tmp_path, pg_engine):
    ticket_id = ticket_fixture(pg_engine)
    prepared = prepare_photos([upload()], tmp_path)
    old = (datetime.now(timezone.utc) - timedelta(days=2)).timestamp()
    os.utime(prepared[0].temporary_path, (old, old))

    def maintenance(connection):
        with Session(pg_engine) as db:
            assert cleanup_orphans(db, AttachmentStore(tmp_path)) == 0

    event.listen(pg_engine, "commit", maintenance)
    try:
        with Session(pg_engine) as db, db.begin():
            stage_photos(db, ticket_id, 1, prepared, purpose="REPORT_PHOTO")
            db.flush()
            publish_photos(prepared)
    finally:
        event.remove(pg_engine, "commit", maintenance)
    assert prepared[0].final_path.read_bytes() == picture()


def test_cleanup_cli_is_real_and_idempotent(tmp_path, pg_engine):
    path = tmp_path / uuid4().hex
    path.write_bytes(picture())
    old = (datetime.now(timezone.utc) - timedelta(hours=25)).timestamp()
    os.utime(path, (old, old))
    env = dict(os.environ, DATABASE_URL=pg_engine.url.render_as_string(hide_password=False),
               ATTACHMENT_STORAGE_PATH=str(tmp_path))
    for expected in [1, 0]:
        result = subprocess.run([sys.executable, "-m", "app.modules.attachments.cleanup"],
                                env=env, capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == f"Attachment cleanup complete: {expected} orphan files removed."
        assert result.stderr == ""


def test_resolution_commit_and_rollback_failure_still_clean_files(creation_app, monkeypatch):
    data = creation_app
    ticket_id = assigned_ticket(data.engine, "IN_PROGRESS", 4)
    authenticated = login(data.app, "TECHNICIAN")

    def failed(*args):
        raise RuntimeError("private fixture DB failure")

    def failing_db():
        with Session(data.engine) as db:
            monkeypatch.setattr(db, "commit", failed)
            monkeypatch.setattr(db, "rollback", failed)
            yield db

    data.app.dependency_overrides[get_db] = failing_db
    with TestClient(data.app, cookies=dict(authenticated.cookies), raise_server_exceptions=False) as client:
        response = client.post(f"/api/tickets/{ticket_id}/resolve", headers=HEADERS,
                               data={"resolution_note": "fixture", "expected_version": "4"},
                               files=[("photos", ("result.png", png_bytes(), "image/png"))])
    assert response.status_code == 500 and "private" not in response.text
    with Session(data.engine) as db:
        ticket = db.get(Ticket, ticket_id)
        assert (ticket.status, ticket.version) == ("IN_PROGRESS", 4)
        assert db.scalar(select(func.count()).select_from(Attachment)) == 0
    assert disk_files(data.storage) == []
