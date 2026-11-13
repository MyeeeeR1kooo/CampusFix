"""The four frozen location endpoints; Origin checks remain in shared Core."""

from typing import Optional

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models import User
from app.modules.auth.dependencies import get_current_user, require_admin
from app.modules.locations import service
from app.modules.locations.schemas import CreateLocationRequest, LocationListResponse, LocationResponse, UpdateLocationRequest


router = APIRouter(prefix="/api", tags=["Locations"])


@router.get("/locations", response_model=LocationListResponse, operation_id="listActiveLocations")
def list_active_locations(
    cursor: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LocationListResponse:
    return service.list_locations(db, cursor, limit, True, settings.secret_key)


@router.get("/admin/locations", response_model=LocationListResponse, operation_id="listAdminLocations")
def list_admin_locations(
    cursor: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LocationListResponse:
    return service.list_locations(db, cursor, limit, False, settings.secret_key)


@router.post("/admin/locations", response_model=LocationResponse, status_code=201, operation_id="createLocation")
def create_location(
    payload: CreateLocationRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LocationResponse:
    return service.create_location(db, payload)


@router.patch("/admin/locations/{id}", response_model=LocationResponse, operation_id="updateLocation")
def update_location(
    payload: UpdateLocationRequest,
    id: int = Path(ge=1, le=2**63 - 1),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LocationResponse:
    return service.update_location(db, id, payload)
