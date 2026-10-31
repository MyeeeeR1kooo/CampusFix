"""Issue #53: assignment through the existing ticket and Workflow APIs."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Assignment, Ticket, TicketEvent, User
from test_workflow_api import (  # noqa: F401 -- shared real PostgreSQL fixtures
    HEADERS, app, assert_schema, assert_state, contract_registry, login,
    pg_engine, ticket_fixture,
)


def test_pending_assignment_queue_uses_existing_filtered_list(app, pg_engine, contract_registry):
    pending = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH")
    ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "LOW")
    ticket_fixture(pg_engine)

    admin = login(app, "ADMIN")
    response = admin.get("/api/tickets", params={"status": "PENDING_ASSIGNMENT", "priority": "HIGH"})
    assert response.status_code == 200, response.text
    assert_schema(response, "TicketList", contract_registry)
    assert [item["id"] for item in response.json()["items"]] == [pending]
    assert response.json()["items"][0]["allowed_actions"][0] == "ASSIGN"
    assert response.json()["next_cursor"] is None

    # A Technician cannot see an unassigned ticket through the shared list.
    technician = login(app, "TECHNICIAN")
    assert technician.get("/api/tickets", params={"status": "PENDING_ASSIGNMENT"}).json() == {
        "items": [], "next_cursor": None,
    }


def test_review_then_assign_grants_current_technician_access(app, pg_engine, contract_registry):
    ticket_id = ticket_fixture(pg_engine)
    admin = login(app, "ADMIN")
    technician = login(app, "TECHNICIAN")
    assert technician.get(f"/api/tickets/{ticket_id}").status_code == 404

    reviewed = admin.post(
        f"/api/tickets/{ticket_id}/review",
        json={"decision": "APPROVE", "category": "HVAC", "priority": "HIGH", "expected_version": 1},
        headers=HEADERS,
    )
    assert reviewed.status_code == 200, reviewed.text
    queue = admin.get("/api/tickets", params={"status": "PENDING_ASSIGNMENT", "priority": "HIGH"})
    assert [item["id"] for item in queue.json()["items"]] == [ticket_id]
    candidates = admin.get("/api/admin/users", params={"role": "TECHNICIAN", "active": True})
    assert candidates.status_code == 200, candidates.text
    technician_id = candidates.json()["items"][0]["id"]

    assigned = admin.post(
        f"/api/tickets/{ticket_id}/assign",
        json={"technician_id": technician_id, "expected_version": reviewed.json()["version"]},
        headers=HEADERS,
    )
    assert assigned.status_code == 200, assigned.text
    assert_schema(assigned, "TicketSummary", contract_registry)
    assert (assigned.json()["status"], assigned.json()["version"]) == ("ASSIGNED", 3)
    assert assigned.json()["current_assignee"]["id"] == technician_id
    assert admin.get("/api/tickets", params={"status": "PENDING_ASSIGNMENT"}).json()["items"] == []

    detail = technician.get(f"/api/tickets/{ticket_id}")
    assert detail.status_code == 200, detail.text
    assert_schema(detail, "TicketDetail", contract_registry)
    assert detail.json()["allowed_actions"][0] == "START"
    assert len(detail.json()["assignments"]) == 1
    assert detail.json()["assignments"][0]["ended_at"] is None
    assert [event["type"] for event in detail.json()["timeline"]] == [
        "TICKET_APPROVED", "TICKET_ASSIGNED",
    ]
    started = technician.post(f"/api/tickets/{ticket_id}/start", json={"expected_version": 3}, headers=HEADERS)
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "IN_PROGRESS"
    assert_state(pg_engine, ticket_id, "IN_PROGRESS", 4, 3, 1)


def test_non_admin_cannot_assign_without_side_effects(app, pg_engine):
    ticket_id = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH")
    for role, expected_status in (("REPORTER", 403), ("TECHNICIAN", 404)):
        response = login(app, role).post(
            f"/api/tickets/{ticket_id}/assign",
            json={"technician_id": 2, "expected_version": 2}, headers=HEADERS,
        )
        assert response.status_code == expected_status, response.text
        assert_state(pg_engine, ticket_id, "PENDING_ASSIGNMENT", 2, 0, 0)


def test_candidate_disabled_after_listing_cannot_be_assigned(app, pg_engine):
    ticket_id = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH")
    admin = login(app, "ADMIN")
    listed = admin.get("/api/admin/users", params={"role": "TECHNICIAN", "active": True})
    assert listed.status_code == 200, listed.text
    technician_id = listed.json()["items"][0]["id"]
    disabled = admin.patch(
        f"/api/admin/users/{technician_id}/active", json={"active": False}, headers=HEADERS,
    )
    assert disabled.status_code == 200, disabled.text

    response = admin.post(
        f"/api/tickets/{ticket_id}/assign",
        json={"technician_id": technician_id, "expected_version": 2}, headers=HEADERS,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["field_errors"][0]["field"] == "technician_id"
    assert_state(pg_engine, ticket_id, "PENDING_ASSIGNMENT", 2, 0, 0)
    with Session(pg_engine) as db:
        assert db.get(Ticket, ticket_id).current_assignee_id is None


def test_concurrent_assignment_has_one_current_owner_and_one_event(app, pg_engine):
    ticket_id = ticket_fixture(pg_engine, "PENDING_ASSIGNMENT", 2, "HIGH")
    with Session(pg_engine) as db, db.begin():
        second = User(
            name="Second fixture technician", email="second-technician@example.invalid",
            password_hash="unused", role="TECHNICIAN", active=True,
        )
        db.add(second)
        db.flush()
        second_id = second.id
    barrier = Barrier(2)

    def submit(technician_id):
        admin = login(app, "ADMIN")
        barrier.wait(timeout=15)
        return admin.post(
            f"/api/tickets/{ticket_id}/assign",
            json={"technician_id": technician_id, "expected_version": 2}, headers=HEADERS,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, (2, second_id)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response for response in responses if response.status_code == 200)
    loser = next(response for response in responses if response.status_code == 409)
    assert loser.json()["error"]["code"] == "TICKET_VERSION_CONFLICT"
    assert_state(pg_engine, ticket_id, "ASSIGNED", 3, 1, 1)
    with Session(pg_engine) as db:
        ticket = db.get(Ticket, ticket_id)
        assignment = db.scalar(select(Assignment).where(Assignment.ticket_id == ticket_id))
        assert ticket.current_assignee_id == assignment.technician_id == winner.json()["current_assignee"]["id"]
        assert assignment.ended_at is None
        assert db.scalar(select(func.count()).select_from(TicketEvent).where(
            TicketEvent.ticket_id == ticket_id, TicketEvent.type == "TICKET_ASSIGNED",
        )) == 1

    repeated = login(app, "ADMIN").post(
        f"/api/tickets/{ticket_id}/assign",
        json={"technician_id": second_id, "expected_version": 2}, headers=HEADERS,
    )
    assert repeated.status_code == 409
    assert_state(pg_engine, ticket_id, "ASSIGNED", 3, 1, 1)
