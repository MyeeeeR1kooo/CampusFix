"""Only the frozen create-comment endpoint; reads use ticket detail.timeline."""

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.comments.schemas import CommentRequest, CommentResponse
from app.modules.comments.service import create_comment


router = APIRouter(prefix="/api/tickets", tags=["Comments"])


@router.post("/{id}/comments", response_model=CommentResponse, status_code=201, operation_id="createComment")
def post_comment(
    payload: CommentRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db, use_cache=False),
) -> CommentResponse:
    return create_comment(db, ticket_id=id, actor=user, payload=payload)
