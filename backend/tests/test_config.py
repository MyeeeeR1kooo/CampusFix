import pytest
from pathlib import Path


def test_settings_load_required_values_and_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://db-user:secret@db/campusfix")
    monkeypatch.setenv("SECRET_KEY", "a" * 32)
    monkeypatch.setenv("ATTACHMENT_STORAGE_PATH", "/var/lib/campusfix/attachments")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173, https://campusfix.example")

    from app.core.config import Settings

    settings = Settings()

    assert settings.database_url.endswith("/campusfix")
    assert settings.secret_key == "a" * 32
    assert settings.attachment_storage_path == Path("/var/lib/campusfix/attachments")
    assert settings.allowed_origins == [
        "http://localhost:5173",
        "https://campusfix.example",
    ]
    assert settings.session_lifetime_seconds == 8 * 60 * 60


def test_settings_reject_wildcard_origin_when_credentials_are_enabled(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://db-user:secret@db/campusfix")
    monkeypatch.setenv("SECRET_KEY", "a" * 32)
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    monkeypatch.setenv("CREDENTIALS_ENABLED", "true")

    from app.core.config import Settings

    with pytest.raises(ValueError, match="wildcard"):
        Settings()
