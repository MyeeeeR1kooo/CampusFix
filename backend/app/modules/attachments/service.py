"""Validate and stage result photos before the workflow database transaction."""

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Attachment


MAX_PHOTOS = 5
MAX_BYTES = 5 * 1024 * 1024
MIME_BY_FORMAT = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


@dataclass(frozen=True)
class PreparedPhoto:
    temporary_path: Path
    final_path: Path
    storage_key: str
    original_name: str
    mime: str
    size: int


def discard_photos(photos: list[PreparedPhoto], published: list[Path] = None) -> None:
    for path in [*(photo.temporary_path for photo in photos), *(published or [])]:
        path.unlink(missing_ok=True)


def prepare_photos(files: list[UploadFile], storage_path: Path) -> list[PreparedPhoto]:
    if len(files) > MAX_PHOTOS:
        raise AppError(ErrorCode.VALIDATION_ERROR, 422, "Too many result photos.", [
            {"field": "photos", "message": "At most five photos are allowed.", "type": "value_error"},
        ])
    if not files:
        return []

    storage_path.mkdir(parents=True, exist_ok=True, mode=0o700)
    prepared = []
    try:
        for file in files:
            if file.content_type not in MIME_BY_FORMAT.values():
                raise AppError(ErrorCode.VALIDATION_ERROR, 415, "Unsupported image type.")
            with tempfile.NamedTemporaryFile(dir=storage_path, prefix=".upload-", delete=False) as temporary:
                temporary_path = Path(temporary.name)
                size = 0
                while chunk := file.file.read(64 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise AppError(ErrorCode.VALIDATION_ERROR, 413, "Photo exceeds 5 MiB.")
                    temporary.write(chunk)
            try:
                with Image.open(temporary_path) as image:
                    mime = MIME_BY_FORMAT.get(image.format)
                    if mime is None or file.content_type != mime:
                        raise AppError(ErrorCode.VALIDATION_ERROR, 415, "Unsupported image type.")
                    image.verify()
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
                raise AppError(ErrorCode.VALIDATION_ERROR, 422, "Invalid image data.") from None
            key = uuid4().hex
            prepared.append(PreparedPhoto(
                temporary_path, storage_path / key, key, file.filename or "photo",
                mime, size,
            ))
        return prepared
    except Exception:
        discard_photos(prepared)
        if "temporary_path" in locals():
            temporary_path.unlink(missing_ok=True)
        raise


def stage_photos(db: Session, ticket_id: int, actor_id: int, photos: list[PreparedPhoto]) -> None:
    if not photos:
        return
    existing = db.scalar(select(func.count()).select_from(Attachment).where(
        Attachment.ticket_id == ticket_id, Attachment.purpose == "RESOLUTION_PHOTO",
    ))
    if existing + len(photos) > MAX_PHOTOS:
        raise AppError(ErrorCode.VALIDATION_ERROR, 422, "Too many result photos.", [
            {"field": "photos", "message": "At most five result photos are allowed.", "type": "value_error"},
        ])
    for photo in photos:
        db.add(Attachment(
            ticket_id=ticket_id, uploader_id=actor_id, storage_key=photo.storage_key,
            original_name=photo.original_name, mime=photo.mime, size=photo.size,
            purpose="RESOLUTION_PHOTO",
        ))


def publish_photos(photos: list[PreparedPhoto]) -> list[Path]:
    published = []
    try:
        for photo in photos:
            os.replace(photo.temporary_path, photo.final_path)
            published.append(photo.final_path)
        return published
    except Exception:
        discard_photos(photos, published)
        raise
