"""Private file access only; uploads use the shared attachments.service helpers."""

import os
import re
import stat
from pathlib import Path
from typing import BinaryIO


CHUNK_BYTES = 64 * 1024
# Existing Workflow/Tickets keys are opaque 32-character hex strings. Accept
# extension-bearing keys from the earlier attachment preview as well.
STORAGE_KEY = re.compile(r"[0-9a-f]{32}(?:\.(?:jpg|png|webp))?\Z")
STAGING_KEY = re.compile(r"\.upload-[a-z0-9_]+\Z")


class AttachmentStore:
    def __init__(self, root: Path):
        self.root = Path(root)

    def open(self, key: str) -> BinaryIO:
        """Open a generated regular file without following links or paths."""
        if STORAGE_KEY.fullmatch(key) is None:
            raise FileNotFoundError("Attachment not found")
        descriptor = os.open(self.root / key, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            os.close(descriptor)
            raise FileNotFoundError("Attachment not found")
        return os.fdopen(descriptor, "rb")
