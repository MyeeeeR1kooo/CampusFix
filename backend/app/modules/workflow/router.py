"""Frozen P0 ticket state action endpoints."""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Path, UploadFile
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models import User
from app.modules.attachments.service import prepare_photos
from app.modules.auth.dependencies import get_current_user
from app.modules.workflow import service
from app.modules.workflow.schemas import ActionRequest, AssignRequest, CancelRequest, ReviewRequest, ReworkRequest, StartRequest


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


@router.post("/{id}/start", operation_id="startTicket")
def start_ticket(
    payload: StartRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return service.transition(db, id, user, "START", payload.expected_version, note=payload.note)


@router.post("/{id}/resolve", operation_id="resolveTicket")
def resolve_ticket(
    resolution_note: str = Form(min_length=1),
    expected_version: int = Form(ge=1),
    photos: Optional[List[UploadFile]] = File(default=None),
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    prepared = prepare_photos(photos or [], settings.attachment_storage_path)
    return service.transition(
        db, id, user, "RESOLVE", expected_version, note=resolution_note, photos=prepared,
    )


@router.post("/{id}/confirm", operation_id="confirmTicket")
def confirm_ticket(
    payload: ActionRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return service.transition(db, id, user, "CONFIRM", payload.expected_version)


@router.post("/{id}/rework", operation_id="reworkTicket")
def rework_ticket(
    payload: ReworkRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return service.transition(db, id, user, "REWORK", payload.expected_version, note=payload.reason)
