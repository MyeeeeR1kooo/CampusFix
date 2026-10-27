"""The frozen CommentRequest and Comment shapes; no extra endpoints or fields."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.tickets.read_models import CommentReadData


class CommentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(strict=True, min_length=1, max_length=2000)
    visibility: Literal["PUBLIC", "ADMIN_ONLY"]


class CommentResponse(CommentReadData):
    body: str = Field(min_length=1, max_length=2000)
