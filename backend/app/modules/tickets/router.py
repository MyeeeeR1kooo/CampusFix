"""Frozen ticket creation, visibility-scoped list and detail endpoints."""

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Form, Path, Query, Request, Response, UploadFile
from pydantic import Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.tickets import creation
from app.modules.tickets.detail_reads import get_ticket_read
from app.modules.tickets.reads import list_ticket_reads
from app.modules.tickets.responses import TicketDetailResponse, TicketListResponse, TicketSummaryResponse
from app.modules.tickets.schemas import CreateTicketFields, TicketListFilters
from app.modules.workflow.service import ticket_projection


router = APIRouter(prefix="/api/tickets", tags=["Tickets"])


class CreateTicketForm(CreateTicketFields):
    photos: Optional[List[UploadFile]] = Field(default=None, max_length=5)


@router.post("", response_model=TicketSummaryResponse, status_code=201, operation_id="createTicket")
def create_ticket(
    response: Response,
    request: Request,
    payload: Annotated[CreateTicketForm, Form(media_type="multipart/form-data")],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db, use_cache=False),
    settings: Settings = Depends(get_settings),
) -> TicketSummaryResponse:
    # A fresh write session keeps image validation ahead of its transaction;
    # authentication uses its own dependency session and remains unchanged.
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "multipart/form-data":
        raise AppError(ErrorCode.VALIDATION_ERROR, 415, "Use multipart/form-data.")
    fields = CreateTicketFields.model_validate(payload.model_dump(exclude={"photos"}))
    ticket = creation.create_ticket(
        db, actor=user, fields=fields, photos=payload.photos or [],
        storage_path=settings.attachment_storage_path,
    )
    response.headers["Location"] = f"/api/tickets/{ticket.id}"
    return ticket


@router.get("", response_model=TicketListResponse, operation_id="listTickets")
def list_tickets(
    filters: Annotated[TicketListFilters, Query()],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TicketListResponse:
    page = list_ticket_reads(db, actor=user, filters=filters, secret_key=settings.secret_key)
    items = []
    for ticket in page.items:
        projection = ticket_projection(
            status=ticket.status, reporter_id=ticket.reporter.id,
            current_assignee_id=ticket.current_assignee.id if ticket.current_assignee else None,
            actor=user,
        )
        items.append(TicketSummaryResponse.model_validate({**ticket.model_dump(), **projection}))
    return TicketListResponse(items=tuple(items), next_cursor=page.next_cursor)


@router.get("/{id}", response_model=TicketDetailResponse, operation_id="getTicket")
def get_ticket(
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketDetailResponse:
    ticket = get_ticket_read(db, actor=user, ticket_id=id)
    projection = ticket_projection(
        status=ticket.status, reporter_id=ticket.reporter.id,
        current_assignee_id=ticket.current_assignee.id if ticket.current_assignee else None,
        actor=user,
    )
    return TicketDetailResponse.model_validate({**ticket.model_dump(), **projection})
