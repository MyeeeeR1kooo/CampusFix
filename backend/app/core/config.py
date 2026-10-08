from functools import lru_cache
from pathlib import Path
from typing import Annotated, List, Optional, Union

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration shared by the backend modules."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = "postgresql+psycopg://campusfix:campusfix@localhost/campusfix"
    secret_key: str = Field(
        default="dev-only-secret-key-change-me-32-chars",
        min_length=32,
    )
    attachment_storage_path: Path = Path("./data/attachments")
    allowed_origins: Annotated[List[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )
    session_lifetime_seconds: int = Field(default=8 * 60 * 60, ge=1)
    environment: str = "local"
    secure_cookies: Optional[bool] = None
    credentials_enabled: bool = True

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: Union[str, List[str]]) -> List[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("allowed_origins")
    @classmethod
    def require_explicit_origins(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("allowed_origins must contain at least one origin")
        return value

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        if self.credentials_enabled and "*" in self.allowed_origins:
            raise ValueError("wildcard origin is not allowed when credentials are enabled")
        if self.secure_cookies is None:
            self.secure_cookies = self.environment.lower() not in {"local", "development", "test"}
        if self.environment.lower() not in {"local", "development", "test"} and not self.secure_cookies:
            raise ValueError("secure_cookies must be enabled outside local development")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
