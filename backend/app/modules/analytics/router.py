from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import User
from app.modules.analytics.schemas import AnalyticsResponse
from app.modules.analytics.service import get_analytics
from app.modules.auth.dependencies import require_admin


router = APIRouter(prefix="/api", tags=["Analytics"])


@router.get("/admin/analytics", response_model=AnalyticsResponse, operation_id="getAnalytics")
def analytics(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AnalyticsResponse:
    return get_analytics(db)
