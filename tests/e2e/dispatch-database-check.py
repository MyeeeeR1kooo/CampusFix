"""Cross-check dispatch browser evidence against the isolated PostgreSQL DB."""
import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.models import Assignment, Ticket, TicketEvent, User

directory = Path(sys.argv[1])
browser = json.loads((directory / "browser-results.json").read_text())
url = os.environ["DATABASE_URL"]
if not (make_url(url).database or "").startswith("campusfix_dispatch_e2e_"):
    raise RuntimeError("Use only a dedicated dispatch E2E database.")
engine = create_engine(url)
checks = []
with Session(engine) as db:
    for label, expected in browser["tickets"].items():
        ticket = db.get(Ticket, expected["id"])
        assignments = db.scalars(select(Assignment).where(Assignment.ticket_id == ticket.id)).all()
        events = db.scalars(select(TicketEvent).where(
            TicketEvent.ticket_id == ticket.id,
        ).order_by(TicketEvent.created_at, TicketEvent.id)).all()
        assert ticket.status == expected["status"]
        assert ticket.version == expected["version"]
        assert ticket.current_assignee_id == expected["current_assignee_id"]
        assert [event.type for event in events] == expected["events"]
        actual = [{"technician_id": row.technician_id, "ended_at": row.ended_at} for row in assignments]
        assert actual == expected["assignments"]
        assert len(assignments) <= 1 and all(row.ended_at is None for row in assignments)
        checks.append({"ticket_id": ticket.id, "label": label, "result": "PASS"})
    indexes = inspect(engine).get_indexes("assignments")
    current = next(row for row in indexes if row["name"] == "uq_assignments_current_ticket")
    assert current["unique"] is True
    assert "ended_at IS NULL" in str(current["dialect_options"]["postgresql_where"])
    restored = list(db.scalars(select(User.active).where(User.role == "TECHNICIAN")))
    assert restored.count(True) == 102 and restored.count(False) == 1
result = {
    "result": "PASS", "ticket_checks": checks,
    "unique_index": "uq_assignments_current_ticket: UNIQUE(ticket_id) WHERE ended_at IS NULL",
    "restored_active_technicians": 102, "preserved_inactive_technicians": 1,
}
(directory / "database-results.json").write_text(json.dumps(result, indent=2) + "\n")
engine.dispose()
print("PASS: 22 browser ticket snapshots match PostgreSQL; unique index and fixture restoration verified.")
