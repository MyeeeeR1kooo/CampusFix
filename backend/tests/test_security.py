from datetime import datetime, timezone

import pytest
from fastapi import Request, Response


def make_request(method="POST", headers=None):
    raw_headers = [
        (key.lower().encode(), value.encode())
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": method,
        "path": "/api/example",
        "headers": raw_headers,
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("testclient", 1234),
        "scheme": "http",
    }
    return Request(scope)


def test_password_hash_uses_argon2id_and_round_trips():
    from app.core.security import hash_password, verify_password

    hashed = hash_password("correct horse battery staple")

    assert hashed.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong password", hashed) is False


def test_session_tokens_are_random_and_only_the_digest_is_persisted():
    from app.core.security import generate_session_token, hash_session_token

    first = generate_session_token()
    second = generate_session_token()

    assert first != second
    assert len(first) >= 32
    assert hash_session_token(first) != first
    assert hash_session_token(first) == hash_session_token(first)


def test_session_cookie_has_secure_defaults_and_expiry():
    from app.core.config import Settings
    from app.core.security import set_session_cookie

    settings = Settings(
        secret_key="a" * 32,
        allowed_origins=["https://campusfix.example"],
        environment="production",
        secure_cookies=True,
        session_lifetime_seconds=3600,
    )
    response = Response()

    set_session_cookie(response, "opaque-token", settings)

    cookie = response.headers["set-cookie"]
    assert "campusfix_session=opaque-token" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" in cookie
    assert "Max-Age=3600" in cookie


def test_same_origin_rejects_missing_or_untrusted_origin():
    from app.core.config import Settings
    from app.core.security import require_same_origin

    settings = Settings(
        secret_key="a" * 32,
        allowed_origins=["https://campusfix.example"],
        environment="production",
        secure_cookies=True,
    )

    with pytest.raises(Exception, match="Origin"):
        require_same_origin(make_request(), settings)
    with pytest.raises(Exception, match="Origin"):
        require_same_origin(
            make_request(headers={"Origin": "https://attacker.example"}),
            settings,
        )


def test_same_origin_allows_configured_origin_and_skips_safe_methods():
    from app.core.config import Settings
    from app.core.security import require_same_origin

    settings = Settings(
        secret_key="a" * 32,
        allowed_origins=["https://campusfix.example"],
        environment="production",
        secure_cookies=True,
    )

    require_same_origin(
        make_request(headers={"Origin": "https://campusfix.example"}),
        settings,
    )
    require_same_origin(make_request(method="GET"), settings)
