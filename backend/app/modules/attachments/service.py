"""Validate and stage business photos before their database transaction."""

import os
import tempfile
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Attachment, Ticket


MAX_PHOTOS = 5
MAX_BYTES = 5 * 1024 * 1024
MIME_BY_FORMAT = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


@dataclass
class _Publication:
    committed: bool = False


@dataclass(frozen=True)
class PreparedPhoto:
    temporary_path: Path
    final_path: Path
    storage_key: str
    original_name: str
    mime: str
    size: int
    _publication: _Publication = field(default_factory=_Publication, repr=False, compare=False)


def discard_photos(photos: list[PreparedPhoto], published: list[Path] = None) -> None:
    # A later response/notification failure cannot undo a durable DB commit.
    protected = {photo.final_path for photo in photos if photo._publication.committed}
    failures = []
    for path in [*(photo.temporary_path for photo in photos), *(published or [])]:
        if path in protected:
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            failures.append(exc)
    if failures:
        raise OSError("Attachment cleanup failed; run orphan maintenance") from failures[0]


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
                while chunk := file.file.read(min(64 * 1024, MAX_BYTES - size + 1)):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise AppError(ErrorCode.VALIDATION_ERROR, 413, "Photo exceeds 5 MiB.")
                    temporary.write(chunk)
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(temporary_path) as image:
                        mime = MIME_BY_FORMAT.get(image.format)
                        if mime is None or file.content_type != mime:
                            raise AppError(ErrorCode.VALIDATION_ERROR, 415, "Unsupported image type.")
                        image.verify()
                    # verify() alone misses truncated JPEG and later frames.
                    with Image.open(temporary_path) as image:
                        for frame in range(getattr(image, "n_frames", 1)):
                            image.seek(frame)
                            image.load()
            except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError,
                    Image.DecompressionBombError, Image.DecompressionBombWarning):
                raise AppError(ErrorCode.VALIDATION_ERROR, 422, "Invalid image data.") from None
            key = uuid4().hex
            prepared.append(PreparedPhoto(
                temporary_path, storage_path / key, key, file.filename or "photo",
                mime, size,
            ))
        return prepared
    except Exception:
        discard_photos(prepared, [temporary_path] if "temporary_path" in locals() else [])
        raise


def stage_photos(
    db: Session, ticket_id: int, actor_id: int, photos: list[PreparedPhoto],
    *, purpose: Literal["REPORT_PHOTO", "RESOLUTION_PHOTO"] = "RESOLUTION_PHOTO",
) -> None:
    if purpose not in {"REPORT_PHOTO", "RESOLUTION_PHOTO"}:
        raise ValueError("Unknown attachment purpose")
    if not photos:
        return
    # Serialize the per-purpose count even for callers outside a state action.
    if db.scalar(select(Ticket.id).where(Ticket.id == ticket_id).with_for_update()) is None:
        raise AppError(ErrorCode.NOT_FOUND, 404, "Ticket not found.")
    # Core sessions disable autoflush: include rows staged earlier in this same
    # transaction before checking the shared per-purpose allowance.
    db.flush()
    existing = db.scalar(select(func.count()).select_from(Attachment).where(
        Attachment.ticket_id == ticket_id, Attachment.purpose == purpose,
    ))
    if existing + len(photos) > MAX_PHOTOS:
        label = "result" if purpose == "RESOLUTION_PHOTO" else "report"
        raise AppError(ErrorCode.VALIDATION_ERROR, 422, f"Too many {label} photos.", [
            {"field": "photos", "message": f"At most five {label} photos are allowed.", "type": "value_error"},
        ])
    for photo in photos:
        db.add(Attachment(
            ticket_id=ticket_id, uploader_id=actor_id, storage_key=photo.storage_key,
            original_name=photo.original_name, mime=photo.mime, size=photo.size,
            purpose=purpose,
        ))
    def committed(session):
        if not session.in_nested_transaction():
            for photo in photos:
                photo._publication.committed = True
    event.listen(db, "after_commit", committed, insert=True)


def publish_photos(photos: list[PreparedPhoto]) -> list[Path]:
    published = []
    try:
        for photo in photos:
            # Reserve exclusively so a collision never overwrites an old file.
            descriptor = os.open(photo.final_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
            published.append(photo.final_path)
            # Reset before publishing: GC must not see a new file with old age.
            os.utime(photo.temporary_path, None, follow_symlinks=False)
            os.replace(photo.temporary_path, photo.final_path)
        return published
    except Exception:
        discard_photos(photos, published)
        raise
