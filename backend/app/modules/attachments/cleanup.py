"""Remove only managed files older than 24h with no attachment reference.

Run explicitly: python -m app.modules.attachments.cleanup
No database rows, foreign paths, symlinks or recent files are deleted.
"""

import stat
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Attachment
from app.modules.attachments.storage import AttachmentStore, STAGING_KEY, STORAGE_KEY


def cleanup_orphans(db: Session, store: AttachmentStore, *, now: Optional[datetime] = None) -> int:
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(hours=24)).timestamp()
    removed = 0
    for directory, pattern, check_reference in [
        (store.root, STORAGE_KEY, True), (store.root, STAGING_KEY, False),
    ]:
        if not directory.exists() or directory.is_symlink():
            continue
        for path in directory.iterdir():
            if pattern.fullmatch(path.name) is None:
                continue
            try:
                info = path.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_mtime >= cutoff:
                continue
            if check_reference and db.scalar(select(Attachment.id).where(Attachment.storage_key == path.name)) is not None:
                continue
            try:
                path.unlink()
                removed += 1
            except FileNotFoundError:
                pass  # Another maintenance process already removed this orphan.
    return removed


def main() -> int:
    try:
        from app.core.config import get_settings
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            removed = cleanup_orphans(db, AttachmentStore(get_settings().attachment_storage_path))
    except Exception:
        print("Attachment cleanup failed. Check private storage and database access.", file=sys.stderr)
        return 1
    print(f"Attachment cleanup complete: {removed} orphan files removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
