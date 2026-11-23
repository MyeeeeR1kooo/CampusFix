from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
import os
from app.models import Location, Ticket, User

url = make_url(os.environ["DATABASE_URL"])
if url.database != "accounts" or url.host is not None or not url.query.get("host", "").startswith("/private/tmp/"):
    raise SystemExit("Use only the isolated accounts fixture database")
engine = create_engine(url)
with Session(engine) as db, db.begin():
    reporter = db.scalar(select(User).where(User.role == "REPORTER"))
    location = db.scalar(select(Location).order_by(Location.id).limit(1))
    db.add(Ticket(code="CF-20261123-900001", title="Synthetic #90 account history", description="Fixture for account-state acceptance only.",
                  reporter_id=reporter.id, location_id=location.id, location_label_snapshot=f"{location.building} / {location.floor} / {location.room_or_area}",
                  category="FURNITURE", status="SUBMITTED", version=1))
engine.dispose()
