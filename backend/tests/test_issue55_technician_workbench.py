"""Issue #55: real assignments feed the current technician's ticket list."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import User
from test_workflow_api import (  # noqa: F401 -- migrated PostgreSQL and real HTTP fixtures
    HEADERS, app, assert_schema, contract_registry, login, pg_engine, ticket_fixture,
)


def test_assigned_list_is_scoped_before_filtering_and_pagination(app, pg_engine, contract_registry):
    with Session(pg_engine) as db, db.begin():
        other = User(
            name="Second fixture technician", email="second-technician@example.invalid",
            password_hash=hash_password("fixture-second-technician"),
            role="TECHNICIAN", active=True,
        )
        db.add(other)
        db.flush()
        other_id = other.id

    admin = login(app, "ADMIN")
    mine = login(app, "TECHNICIAN")
    other = TestClient(app)
    signed_in = other.post(
        "/api/auth/login",
        json={"email": "second-technician@example.invalid", "password": "fixture-second-technician"},
        headers=HEADERS,
    )
    assert signed_in.status_code == 200, signed_in.text

    my_ids = [ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH") for _ in range(2)]
    other_ticket = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "LOW")
    unassigned = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "MEDIUM")
    for ticket_id, technician_id in [
        (my_ids[0], 2), (other_ticket, other_id), (my_ids[1], 2),
    ]:
        response = admin.post(
            f"/api/tickets/{ticket_id}/assign",
            json={"technician_id": technician_id, "expected_version": 2}, headers=HEADERS,
        )
        assert response.status_code == 200, response.text

    first = mine.get("/api/tickets", params={"status": "ASSIGNED", "limit": 1})
    assert_schema(first, "TicketList", contract_registry)
    cursor = first.json()["next_cursor"]
    assert cursor
    second = mine.get("/api/tickets", params={"status": "ASSIGNED", "limit": 1, "cursor": cursor})
    assert_schema(second, "TicketList", contract_registry)
    assert second.json()["next_cursor"] is None
    rows = first.json()["items"] + second.json()["items"]
    assert {row["id"] for row in rows} == set(my_ids)
    assert all(row["current_assignee"]["id"] == 2 for row in rows)
    assert all(row["status"] == "ASSIGNED" and row["priority"] == "HIGH" for row in rows)
    assert all(row["location_label_snapshot"] and row["created_at"] for row in rows)
    assert mine.get("/api/tickets", params={"status": "PENDING_ASSIGNMENT"}).json() == {
        "items": [], "next_cursor": None,
    }

    other_list = other.get("/api/tickets")
    assert_schema(other_list, "TicketList", contract_registry)
    assert [row["id"] for row in other_list.json()["items"]] == [other_ticket]
    assert other.get(f"/api/tickets/{my_ids[0]}").status_code == 404
    assert mine.get(f"/api/tickets/{other_ticket}").status_code == 404
    assert mine.get(f"/api/tickets/{unassigned}").status_code == 404


def test_workbench_list_requires_auth_and_technicians_cannot_choose_an_assignee(
    app, pg_engine, contract_registry,
):
    anonymous = TestClient(app).get("/api/tickets")
    assert anonymous.status_code == 401
    assert_schema(anonymous, "ErrorResponse", contract_registry)
    assert anonymous.json()["error"]["code"] == "UNAUTHORIZED"

    technician = login(app, "TECHNICIAN")
    reporter = login(app, "REPORTER")
    for client in (technician, reporter):
        denied = client.get("/api/tickets", params={"current_assignee_id": 2})
        assert denied.status_code == 403
        assert_schema(denied, "ErrorResponse", contract_registry)
        assert denied.json()["error"]["code"] == "FORBIDDEN"

    # The shared list remains available to Reporter within the reporter's scope.
    ticket_id = ticket_fixture(pg_engine)
    visible = reporter.get("/api/tickets")
    assert_schema(visible, "TicketList", contract_registry)
    assert [row["id"] for row in visible.json()["items"]] == [ticket_id]
    assert technician.get("/api/tickets").json() == {"items": [], "next_cursor": None}
