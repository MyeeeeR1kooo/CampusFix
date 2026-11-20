"""#51/#54 acceptance through real creation, detail and cancellation routes."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import Attachment, Comment, Ticket, TicketEvent, User
from test_ticket_creation_api import creation_app, fields, submit  # noqa: F401
from test_workflow_api import (  # noqa: F401
    HEADERS, assert_schema, contract_registry, login, pg_engine, png_bytes,
)


@pytest.mark.parametrize("with_photo", [False, True])
def test_created_ticket_keeps_comments_snapshot_and_photos_after_cancel(
    creation_app, contract_registry, with_photo,
):
    data = creation_app
    reporter, admin = [login(data.app, role) for role in ["REPORTER", "ADMIN"]]
    password = "handoff-fixture-only-password"
    with Session(data.engine) as db, db.begin():
        db.add(User(name="Unrelated handoff reporter", email="handoff-b@example.invalid",
                    role="REPORTER", password_hash=hash_password(password)))
    other = TestClient(data.app)
    signed_in = other.post("/api/auth/login", headers=HEADERS,
                           json={"email": "handoff-b@example.invalid", "password": password})
    assert signed_in.status_code == 200

    photos = [("report.png", png_bytes(), "image/png")] if with_photo else []
    with TestClient(data.app, cookies=dict(reporter.cookies), raise_server_exceptions=False) as create_client:
        created = submit(create_client, fields(data, title="Seam %_ attachment handoff"), photos)
    assert created.status_code == 201, created.text
    assert_schema(created, "TicketSummary", contract_registry)
    ticket_id = created.json()["id"]
    url = created.headers["location"]
    before = reporter.get(url).json()
    assert (before["status"], before["version"]) == ("SUBMITTED", 1)
    assert len(before["report_photos"]) == int(with_photo)
    assert other.get(url).status_code == 404

    public = reporter.post(url + "/comments", headers=HEADERS,
                           json={"body": "Reporter public handoff", "visibility": "PUBLIC"})
    internal = admin.post(url + "/comments", headers=HEADERS,
                          json={"body": "ADMIN-HANDOFF-PRIVATE", "visibility": "ADMIN_ONLY"})
    for response in [public, internal]:
        assert response.status_code == 201, response.text
        assert_schema(response, "Comment", contract_registry)
    assert other.post(url + "/comments", headers=HEADERS,
                      json={"body": "Not my ticket", "visibility": "PUBLIC"}).status_code == 404
    after_comments = reporter.get(url).json()
    assert (after_comments["status"], after_comments["version"], after_comments["updated_at"]) == (
        before["status"], before["version"], before["updated_at"],
    )

    renamed = admin.patch(f"/api/admin/locations/{data.location_id}", headers=HEADERS,
                          json={"building": "Renamed handoff building", "active": False})
    assert renamed.status_code == 200, renamed.text
    cancelled = reporter.post(url + "/cancel", headers=HEADERS,
                              json={"expected_version": 1, "reason": "No longer needed"})
    assert cancelled.status_code == 200, cancelled.text
    assert_schema(cancelled, "TicketSummary", contract_registry)
    assert (cancelled.json()["status"], cancelled.json()["version"]) == ("CANCELLED", 2)

    for client, expected_comments in [(reporter, [public.json()["id"]]),
                                      (admin, [public.json()["id"], internal.json()["id"]])]:
        response = client.get(url)
        assert response.status_code == 200, response.text
        assert_schema(response, "TicketDetail", contract_registry)
        detail = response.json()
        assert detail["location_label_snapshot"] == data.snapshot
        assert detail["report_photos"] == before["report_photos"]
        assert detail["allowed_actions"] == []
        assert [row["id"] for row in detail["timeline"] if row["kind"] == "COMMENT"] == expected_comments
        assert [row["type"] for row in detail["timeline"] if row["kind"] == "EVENT"] == [
            "TICKET_SUBMITTED", "TICKET_CANCELLED",
        ]
        rejected = client.post(url + "/comments", headers=HEADERS,
                               json={"body": "Too late", "visibility": "PUBLIC"})
        assert rejected.status_code == 409, rejected.text
        assert_schema(rejected, "ErrorResponse", contract_registry)
        assert rejected.json()["error"]["code"] == "CONFLICT"
    assert "ADMIN-HANDOFF-PRIVATE" not in reporter.get(url).text
    page = reporter.get("/api/tickets", params={"q": "seam %_", "status": "CANCELLED"})
    assert page.status_code == 200, page.text
    assert_schema(page, "TicketList", contract_registry)
    assert [(row["id"], row["version"]) for row in page.json()["items"]] == [(ticket_id, 2)]
    assert other.get("/api/tickets").json()["items"] == []
    with Session(data.engine) as db:
        assert (db.get(Ticket, ticket_id).status, db.get(Ticket, ticket_id).version) == ("CANCELLED", 2)
        for model, count in [(Comment, 2), (TicketEvent, 2), (Attachment, int(with_photo))]:
            assert db.scalar(select(func.count()).select_from(model)) == count

    # Keep the real download path: a platform failure must remain a failing test.
    if with_photo:
        photo_url = before["report_photos"][0]["download_url"]
        for client in [reporter, admin]:
            with TestClient(data.app, cookies=dict(client.cookies), raise_server_exceptions=False) as download_client:
                downloaded = download_client.get(photo_url)
            assert downloaded.status_code == 200, downloaded.text
            assert downloaded.content == png_bytes()
            assert downloaded.headers["cache-control"] == "private, no-store"
        assert other.get(photo_url).status_code == 404


def test_existing_saved_photo_download_uses_real_detail_url(creation_app):
    """Seed a saved photo so publication failure cannot hide a download failure."""
    data = creation_app
    reporter = login(data.app, "REPORTER")
    created = submit(reporter, fields(data))
    assert created.status_code == 201, created.text
    content = png_bytes()
    key = uuid4().hex
    data.storage.mkdir()
    (data.storage / key).write_bytes(content)
    with Session(data.engine) as db, db.begin():
        db.add(Attachment(ticket_id=created.json()["id"], uploader_id=1,
                          storage_key=key, original_name="saved.png", mime="image/png",
                          size=len(content), purpose="REPORT_PHOTO"))
    detail = reporter.get(created.headers["location"])
    assert detail.status_code == 200, detail.text
    photo_url = detail.json()["report_photos"][0]["download_url"]
    with TestClient(data.app, cookies=dict(reporter.cookies), raise_server_exceptions=False) as client:
        response = client.get(photo_url)
    assert response.status_code == 200, response.text
    assert response.content == content
