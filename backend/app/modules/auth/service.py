"""Session persistence operations owned by Auth."""

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import Session as AuthSession


def revoke_user_sessions(db: Session, user_id: int) -> None:
    """Revoke all sessions in the caller's account-update transaction."""
    db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
