"""Location read seam for #51's caller-owned ticket creation transaction.

This does not create a ticket or persist its snapshot. Tickets must call it
after attachment validation, save the returned values in its short write
transaction, and commit or roll back that entire use case with Workflow.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Location


@dataclass(frozen=True)
class TicketLocationSnapshot:
    location_id: int
    location_label_snapshot: str


def select_location_for_ticket(db: Session, location_id: int) -> TicketLocationSnapshot:
    """Resolve a validated location ID without committing the caller's work.

    FOR SHARE permits concurrent ticket creations but blocks maintenance of
    this location until the caller ends its transaction. Column reads avoid
    accepting stale ORM identity-map values. The caller must not retain this
    lock across image validation or other slow external work.
    """
    statement = (
        select(Location.id, Location.building, Location.floor, Location.room_or_area, Location.active)
        .where(Location.id == location_id)
        .with_for_update(read=True)
    )
    with db.no_autoflush:
        location = db.execute(statement).one_or_none()
    if location is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, 422, "Select an active location.",
            field_errors=[{
                "field": "location_id",
                "message": "The selected location does not exist.",
                "type": "value_error",
            }],
        )
    if not location.active:
        raise AppError(
            ErrorCode.CONFLICT, 409,
            "The selected location is inactive. Select an active location.",
        )
    return TicketLocationSnapshot(
        location_id=location.id,
        location_label_snapshot=f"{location.building} / {location.floor} / {location.room_or_area}",
    )
