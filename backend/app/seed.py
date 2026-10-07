"""Idempotent anonymous demo data. Run after `alembic upgrade head`.

Existing accounts keep their passwords, roles, active flags and timestamps.
This command is initialization, not account management or password reset.
"""

import sys
from dataclasses import dataclass

from pydantic import SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import Location, User


DEMO_ACCOUNTS = (
    ("REPORTER", "演示报修人", "demo-reporter@example.invalid"),
    ("TECHNICIAN", "演示维修员", "demo-technician@example.invalid"),
    ("ADMIN", "演示管理员", "demo-admin@example.invalid"),
)
DEMO_LOCATIONS = (
    ("演示楼 A", "1", "示例房间 101"),
    ("演示楼 A", "2", "示例公共区域"),
    ("演示楼 B", "1", "示例房间 102"),
)


class SeedPasswords(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SEED_", env_file=".env", extra="ignore"
    )
    reporter_password: SecretStr
    technician_password: SecretStr
    admin_password: SecretStr

    @field_validator("reporter_password", "technician_password", "admin_password")
    @classmethod
    def require_password(cls, value):
        if not value.get_secret_value().strip():
            raise ValueError("Demo password must not be blank")
        return value

    def for_role(self, role: str) -> str:
        return getattr(self, role.lower() + "_password").get_secret_value()


@dataclass(frozen=True)
class SeedResult:
    users_created: int
    locations_created: int


def seed_demo_data(session: Session, passwords: SeedPasswords) -> SeedResult:
    """Insert missing rows; caller owns the transaction and commit/rollback."""
    users_created = 0
    locations_created = 0
    for role, name, email in DEMO_ACCOUNTS:
        existing = session.scalar(select(User).where(User.email == email))
        if existing is None:
            user_id = session.scalar(
                insert(User).values(
                    name=name, email=email, role=role,
                    password_hash=hash_password(passwords.for_role(role)),
                ).on_conflict_do_nothing(index_elements=[User.email]).returning(User.id)
            )
            users_created += int(user_id is not None)
            # Also check the row when another seed process won the unique-key race.
            existing = session.scalar(select(User).where(User.email == email))
        if existing.role != role:
            raise ValueError("A demo account already exists with a different role")
    for building, floor, room in DEMO_LOCATIONS:
        location_id = session.scalar(
            insert(Location).values(building=building, floor=floor, room_or_area=room)
            .on_conflict_do_nothing(index_elements=[Location.building, Location.floor, Location.room_or_area])
            .returning(Location.id)
        )
        locations_created += int(location_id is not None)
    return SeedResult(users_created, locations_created)


def main() -> int:
    try:
        passwords = SeedPasswords()
    except ValidationError:
        # ValidationError text can contain secret inputs. Print variable names only.
        print("Set non-empty SEED_REPORTER_PASSWORD, SEED_TECHNICIAN_PASSWORD and SEED_ADMIN_PASSWORD.", file=sys.stderr)
        return 1
    try:
        from app.core.database import SessionLocal

        with SessionLocal.begin() as session:
            result = seed_demo_data(session, passwords)
    except Exception:
        # Never include SQL parameters, hashes or connection credentials in output.
        print("Seed failed; transaction rolled back. Check database migration and demo account roles.", file=sys.stderr)
        return 1
    print(f"Seed complete: {result.users_created} users, {result.locations_created} locations created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
