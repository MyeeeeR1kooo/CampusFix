"""Prepare fictional technicians in a fresh, isolated dispatch E2E database."""
import os

from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import Ticket, User
from app.seed import SeedPasswords, seed_demo_data

url = os.environ["DATABASE_URL"]
if not (make_url(url).database or "").startswith("campusfix_dispatch_e2e_"):
    raise RuntimeError("Use a dedicated campusfix_dispatch_e2e_* database.")
engine = create_engine(url)
with Session(engine) as db, db.begin():
    if db.scalar(select(func.count()).select_from(User)) or db.scalar(select(func.count()).select_from(Ticket)):
        raise RuntimeError("Fixtures require a fresh migrated database.")
    passwords = SeedPasswords(_env_file=None)
    seed_demo_data(db, passwords)
    # Force the real assignment dialog to fetch two candidate pages.
    password_hash = hash_password(passwords.for_role("TECHNICIAN"))
    for index in range(1, 102):
        db.add(User(
            name=f"Dispatch Technician {index:03d}",
            email=f"dispatch-tech{index:03d}@example.invalid",
            password_hash=password_hash, role="TECHNICIAN", active=True,
        ))
    db.add(User(
        name="Inactive Dispatch Technician", email="inactive-dispatch-tech@example.invalid",
        password_hash=password_hash, role="TECHNICIAN", active=False,
    ))
engine.dispose()
print("Prepared reporter, admin, 102 active and 1 inactive technicians.")
