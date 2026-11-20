"""Create a ticket, submission event and optional photos as one business action."""

from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Ticket, User
from app.modules.attachments.service import (
    discard_photos, prepare_photos, publish_photos, stage_photos,
)
from app.modules.locations.ticket_selection import select_location_for_ticket
from app.modules.tickets.numbering import format_ticket_code
from app.modules.tickets.responses import TicketSummaryResponse
from app.modules.tickets.schemas import CreateTicketFields
from app.modules.workflow.service import ticket_summary
from app.modules.workflow.submission import initialize_submission


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_ticket(
    db: Session, *, actor: User, fields: CreateTicketFields,
    photos: list[UploadFile], storage_path: Path,
) -> TicketSummaryResponse:
    """Own a fresh business session; Auth uses its separate read session.

    Decode uploads before any business SQL or location lock. The short write
    transaction includes the ticket, Workflow event and photo metadata; files
    are published only after flushing and validating the complete response.
    """
    if not actor.active:
        raise AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication failed.")
    if actor.role != "REPORTER":
        raise AppError(ErrorCode.FORBIDDEN, 403, "This action is not allowed.")
    prepared = []
    published = []
    try:
        prepared = prepare_photos(photos, storage_path)
        snapshot = select_location_for_ticket(db, fields.location_id)
        created_at = _now_utc()
        ticket_id = db.scalar(text("SELECT nextval(pg_get_serial_sequence('tickets', 'id'))"))
        ticket = Ticket(
            id=ticket_id,
            code=format_ticket_code(
                ticket_id=ticket_id,
                calendar_date=created_at.astimezone(ZoneInfo("Asia/Shanghai")).date(),
            ),
            reporter_id=actor.id,
            location_id=snapshot.location_id,
            location_label_snapshot=snapshot.location_label_snapshot,
            title=fields.title, description=fields.description, category=fields.category,
            created_at=created_at, updated_at=created_at,
        )
        initialize_submission(db, ticket, actor, created_at=created_at)
        stage_photos(db, ticket.id, actor.id, prepared, purpose="REPORT_PHOTO")
        db.flush()
        response = TicketSummaryResponse.model_validate(ticket_summary(db, ticket, actor))
        published = publish_photos(prepared)
        db.commit()
        return response
    except Exception:
        try:
            db.rollback()
        finally:
            discard_photos(prepared, published)
        raise
