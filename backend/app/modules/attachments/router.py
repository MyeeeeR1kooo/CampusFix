"""The frozen authorized download endpoint; there is no standalone upload route."""

from typing import Iterator
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.models import Attachment, Ticket, User
from app.modules.auth.dependencies import get_current_user
from app.modules.attachments.service import MIME_BY_FORMAT
from app.modules.attachments.storage import AttachmentStore, CHUNK_BYTES
from app.modules.tickets.access import ticket_is_visible


router = APIRouter(prefix="/api", tags=["Attachments"])


@router.get("/attachments/{id}", operation_id="downloadAttachment")
def download_attachment(
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    result = db.execute(select(Attachment, Ticket).join(Ticket, Ticket.id == Attachment.ticket_id)
                        .where(Attachment.id == id)).one_or_none()
    if result is None:
        raise AppError(ErrorCode.NOT_FOUND, 404, "Attachment not found.")
    attachment, ticket = result
    if not ticket_is_visible(actor_id=user.id, actor_role=user.role, reporter_id=ticket.reporter_id,
                             current_assignee_id=ticket.current_assignee_id):
        raise AppError(ErrorCode.NOT_FOUND, 404, "Attachment not found.")
    if attachment.mime not in MIME_BY_FORMAT.values():
        raise AppError(ErrorCode.NOT_FOUND, 404, "Attachment not found.")
    try:
        source = AttachmentStore(settings.attachment_storage_path).open(attachment.storage_key)
    except (FileNotFoundError, IsADirectoryError, OSError):
        raise AppError(ErrorCode.NOT_FOUND, 404, "Attachment not found.") from None

    def chunks() -> Iterator[bytes]:
        try:
            while block := source.read(CHUNK_BYTES):
                yield block
        finally:
            source.close()

    return StreamingResponse(
        chunks(), media_type=attachment.mime,
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(attachment.original_name, safe=""),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(source.close),
    )
