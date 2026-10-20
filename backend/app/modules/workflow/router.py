"""Frozen Update 2 ticket action endpoints."""

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.workflow import service
from app.modules.workflow.schemas import AssignRequest, CancelRequest, ReviewRequest


router = APIRouter(prefix="/api/tickets", tags=["Workflow"])


@router.post("/{id}/review", operation_id="reviewTicket")
def review_ticket(
    payload: ReviewRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.decision == "APPROVE":
        return service.transition(
            db, id, user, "APPROVE", payload.expected_version,
            category=payload.category, priority=payload.priority,
        )
    return service.transition(
        db, id, user, "REJECT", payload.expected_version, note=payload.reason,
    )


@router.post("/{id}/cancel", operation_id="cancelTicket")
def cancel_ticket(
    payload: CancelRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return service.transition(
        db, id, user, "CANCEL", payload.expected_version, note=payload.reason,
    )


@router.post("/{id}/assign", operation_id="assignTicket")
def assign_ticket(
    payload: AssignRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return service.transition(
        db, id, user, "ASSIGN", payload.expected_version,
        technician_id=payload.technician_id,
    )
