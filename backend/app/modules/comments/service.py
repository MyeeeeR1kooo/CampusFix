"""Append a comment without changing ticket status, version or events."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Comment, Ticket, User
from app.modules.comments.schemas import CommentRequest, CommentResponse
from app.modules.tickets.access import require_ticket_visible
from app.modules.workflow.rules import TERMINAL_STATUSES


def create_comment(db: Session, *, ticket_id: int, actor: User, payload: CommentRequest) -> CommentResponse:
    try:
        # Workflow's UPDATE must serialize against this check-and-insert. Refresh
        # after acquiring the lock, including for callers with an identity map.
        ticket = db.scalar(select(Ticket).where(Ticket.id == ticket_id).with_for_update()
                           .execution_options(populate_existing=True))
        if ticket is None:
            raise AppError(ErrorCode.NOT_FOUND, 404, "Resource not found.")
        require_ticket_visible(actor_id=actor.id, actor_role=actor.role,
                               reporter_id=ticket.reporter_id, current_assignee_id=ticket.current_assignee_id)
        if payload.visibility == "ADMIN_ONLY" and actor.role != "ADMIN":
            raise AppError(ErrorCode.FORBIDDEN, 403, "Only administrators can create internal notes.")
        if ticket.status in TERMINAL_STATUSES:
            raise AppError(ErrorCode.CONFLICT, 409, "Comments cannot be added to a terminal ticket.")
        row = Comment(ticket_id=ticket.id, author_id=actor.id, body=payload.body, visibility=payload.visibility)
        db.add(row)
        db.flush()
        response = CommentResponse(
            id=row.id, ticket_id=row.ticket_id,
            author={"id": actor.id, "name": actor.name, "role": actor.role},
            body=row.body, visibility=row.visibility, created_at=row.created_at,
        )
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise
