"""Initialize a new submission and event in the caller's creation transaction."""

from datetime import datetime

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Ticket, TicketEvent, User


def initialize_submission(
    db: Session, ticket: Ticket, actor: User, *, created_at: datetime,
) -> None:
    """Only a new ticket may use initialization instead of a versioned action."""
    if actor.role != "REPORTER" or ticket.reporter_id != actor.id:
        raise AppError(ErrorCode.FORBIDDEN, 403, "This action is not allowed.")
    if not inspect(ticket).transient:
        raise ValueError("Submission initialization requires a new ticket.")
    ticket.status = "SUBMITTED"
    ticket.version = 1
    ticket.priority = None
    ticket.current_assignee_id = None
    ticket.closed_at = None
    db.add(ticket)
    # No ORM relationships connect these mappings; persist the parent first.
    db.flush()
    db.add(TicketEvent(
        ticket_id=ticket.id, actor_id=actor.id, type="TICKET_SUBMITTED",
        from_status=None, to_status="SUBMITTED", note=None, visibility="PUBLIC",
        created_at=created_at,
    ))
