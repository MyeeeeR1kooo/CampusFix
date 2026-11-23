"""Synthetic rows and independent aggregate oracle for the isolated #58 acceptance DB."""
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(os.environ['REPO_DIR']) / 'backend'))
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from app.models import Location, Ticket, TicketEvent, User

url = make_url(os.environ['DATABASE_URL'])
socket = Path(url.query.get('host', '')).resolve()
assert url.host is None and socket.is_relative_to('/private/tmp') and socket.name == 'socket', 'Dedicated local tmp socket only'
assert url.database == 'analytics', 'Dedicated analytics test DB only'
engine = create_engine(url)
zone = ZoneInfo('Asia/Shanghai')
today = datetime.now(zone).date()
first = today - timedelta(days=29)
midnight = datetime.combine(today, datetime.min.time(), zone)
statuses = ['SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED']
categories = ['LIGHTING_ELECTRICAL', 'DOORS_WINDOWS_LOCKS', 'FURNITURE', 'HVAC', 'WATER_SANITARY', 'OTHER_FACILITY']
terminal = {'CLOSED', 'REJECTED', 'CANCELLED'}

with Session(engine) as db, db.begin():
    assert db.scalar(select(func.count(Ticket.id))) == 0, 'Refuse to append to non-empty fixture DB'
    reporter = db.scalar(select(User).where(User.role == 'REPORTER'))
    tech = db.scalar(select(User).where(User.role == 'TECHNICIAN'))
    assert reporter and tech
    locations = [Location(building=f'Analytics Building {letter}', floor='1', room_or_area='Synthetic 101') for letter in 'ABC']
    db.add_all(locations)
    db.flush()
    specs = [(s, midnight-timedelta(days=2)+timedelta(hours=12), 86400 if s == 'CLOSED' else None) for s in statuses]
    specs += [('CLOSED', midnight-timedelta(days=4)+timedelta(hours=12), 172800), ('CLOSED', midnight-timedelta(days=35)+timedelta(hours=12), 345600)]
    # Start-window midnight and today's midnight are each bracketed by one second.
    specs += [('SUBMITTED', midnight-timedelta(days=29, seconds=1), None), ('SUBMITTED', midnight-timedelta(days=29), None), ('SUBMITTED', midnight-timedelta(seconds=1), None), ('SUBMITTED', midnight, None)]
    specs += [('CANCELLED', midnight+timedelta(days=1), None)]
    for i, (status, created, duration) in enumerate(specs):
        loc = locations[i % len(locations)]
        t = Ticket(code=f'CF-{created:%Y%m%d}-{900100+i+1:06}', reporter_id=reporter.id, location_id=loc.id,
                   location_label_snapshot=f'{loc.building} / 1 / Synthetic 101',
                   title=f'Analytics synthetic fixture {i+1}', description='Disposable #58 aggregate fixture; no real users or repairs.',
                   category=categories[i % len(categories)], priority=None if status in ('SUBMITTED','REJECTED','CANCELLED') else 'HIGH',
                   status=status, current_assignee_id=tech.id if status in ('ASSIGNED','IN_PROGRESS','PENDING_CONFIRMATION','CLOSED') else None,
                   version=6 if status == 'CLOSED' else 1, created_at=created,
                   updated_at=created+timedelta(seconds=duration or 0), closed_at=created+timedelta(seconds=duration) if duration else None)
        db.add(t)
        db.flush()
        if duration:
            db.add_all([
                TicketEvent(ticket_id=t.id, actor_id=tech.id, type='RESOLUTION_SUBMITTED', from_status='IN_PROGRESS', to_status='PENDING_CONFIRMATION', note='Synthetic result after one hour', visibility='PUBLIC', created_at=created+timedelta(hours=1)),
                TicketEvent(ticket_id=t.id, actor_id=reporter.id, type='TICKET_CLOSED', from_status='PENDING_CONFIRMATION', to_status='CLOSED', note=None, visibility='PUBLIC', created_at=t.closed_at),
            ])

with Session(engine) as db:
    raw = db.execute(select(Ticket, Location.building).join(Location, Ticket.location_id == Location.id).order_by(Ticket.id)).all()
    status_counts = Counter(t.status for t, _ in raw)
    category_counts = Counter(t.category for t, _ in raw)
    building_counts = Counter(b for _, b in raw)
    created = Counter(t.created_at.astimezone(zone).date() for t, _ in raw)
    closed = Counter(t.closed_at.astimezone(zone).date() for t, _ in raw if t.status == 'CLOSED')
    durations = [(t.closed_at-t.created_at).total_seconds() for t, _ in raw if t.status == 'CLOSED']
    expected = {
        'by_status': [{'status':s, 'count':status_counts[s]} for s in statuses],
        'by_category': [{'category':s, 'count':category_counts[s]} for s in categories],
        'by_building': [{'building':s, 'count':building_counts[s]} for s in sorted(building_counts)],
        'backlog_count':sum(1 for t, _ in raw if t.status not in terminal),
        'average_close_seconds':sum(durations)/len(durations),
        'daily_trend':[{'date':(first+timedelta(days=i)).isoformat(), 'created_count':created[first+timedelta(days=i)], 'closed_count':closed[first+timedelta(days=i)]} for i in range(30)],
    }
    assert len(raw) == 15 and expected['backlog_count'] == 9
    assert durations == [86400, 172800, 345600] and expected['average_close_seconds'] == 201600
    assert sum(d['created_count'] for d in expected['daily_trend']) == 12
    assert sum(d['closed_count'] for d in expected['daily_trend']) == 2
    fixture_rows = [{'id':t.id, 'status':t.status, 'category':t.category, 'building':b, 'created_at':t.created_at.isoformat(), 'closed_at':t.closed_at.isoformat() if t.closed_at else None} for t,b in raw]
    resolution_times = db.execute(select(TicketEvent.ticket_id, TicketEvent.created_at).where(TicketEvent.type == 'RESOLUTION_SUBMITTED').order_by(TicketEvent.ticket_id)).all()
    result = {'source_commit':os.environ['SOURCE_COMMIT'], 'oracle':'Python Counter and zoneinfo aggregation of actual PostgreSQL rows; does not call application analytics service', 'timezone':'Asia/Shanghai', 'today':today.isoformat(), 'window_start':first.isoformat(), 'fixture_rows':fixture_rows, 'resolution_events':[{'ticket_id':i,'at':d.isoformat()} for i,d in resolution_times], 'expected':expected, 'checks':{'all_eight_statuses':True,'all_six_categories':True,'three_buildings':True,'full_close_duration_seconds':durations,'processing_only_average_seconds':3600,'expected_full_average_seconds':201600,'start_midnight_boundary_pair':True,'today_midnight_boundary_pair':True,'old_and_future_created_excluded_from_trend':True,'old_closed_still_in_all_time_average':True}}
    target = Path(os.environ['RESULT_DIR']) / 'analytics-db-oracle.json'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Created 15 synthetic tickets; independent DB oracle saved')
engine.dispose()
