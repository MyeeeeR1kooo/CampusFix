"""create P0 core tables

Revision ID: 0001
Revises: none
"""
from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Frozen P0 §10.1–10.3: explicit schema snapshot, independent of app models.
    op.create_table('locations',
    sa.Column('building', sa.Text(), nullable=False),
    sa.Column('floor', sa.Text(), nullable=False),
    sa.Column('room_or_area', sa.Text(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.CheckConstraint('length(building) > 0 AND length(floor) > 0 AND length(room_or_area) > 0', name='ck_locations_nonempty'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('building', 'floor', 'room_or_area', name='uq_locations_address')
    )
    op.create_table('users',
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('email', sa.Text(), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('role', sa.Text(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.CheckConstraint("role IN ('REPORTER', 'TECHNICIAN', 'ADMIN')", name='ck_users_role'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email', name='uq_users_email')
    )
    op.create_table('sessions',
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('token_hash', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash', name='uq_sessions_token_hash')
    )
    op.create_index('ix_sessions_user_id', 'sessions', ['user_id'], unique=False)
    op.create_table('tickets',
    sa.Column('code', sa.Text(), nullable=False),
    sa.Column('reporter_id', sa.BigInteger(), nullable=False),
    sa.Column('location_id', sa.BigInteger(), nullable=False),
    sa.Column('location_label_snapshot', sa.Text(), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('category', sa.Text(), nullable=False),
    sa.Column('priority', sa.Text(), nullable=True),
    sa.Column('status', sa.Text(), server_default=sa.text("'SUBMITTED'"), nullable=False),
    sa.Column('current_assignee_id', sa.BigInteger(), nullable=True),
    sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.CheckConstraint("(status = 'CLOSED' AND closed_at IS NOT NULL) OR (status <> 'CLOSED' AND closed_at IS NULL)", name='ck_tickets_closed_at'),
    sa.CheckConstraint("(status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'REJECTED', 'CANCELLED') AND current_assignee_id IS NULL) OR (status IN ('ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED') AND current_assignee_id IS NOT NULL)", name='ck_tickets_assignee'),
    sa.CheckConstraint("category IN ('LIGHTING_ELECTRICAL', 'DOORS_WINDOWS_LOCKS', 'FURNITURE', 'HVAC', 'WATER_SANITARY', 'OTHER_FACILITY')", name='ck_tickets_category'),
    sa.CheckConstraint("priority IS NULL OR priority IN ('LOW', 'MEDIUM', 'HIGH')", name='ck_tickets_priority'),
    sa.CheckConstraint("status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED')", name='ck_tickets_status'),
    sa.CheckConstraint("status IN ('SUBMITTED', 'REJECTED', 'CANCELLED') OR priority IS NOT NULL", name='ck_tickets_priority_required'),
    sa.CheckConstraint('version >= 1', name='ck_tickets_version'),
    sa.ForeignKeyConstraint(['current_assignee_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['location_id'], ['locations.id'], ),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code', name='uq_tickets_code')
    )
    op.create_index('ix_tickets_assignee_created_id', 'tickets', ['current_assignee_id', sa.literal_column('created_at DESC'), sa.literal_column('id DESC')], unique=False)
    op.create_index('ix_tickets_location_created_id', 'tickets', ['location_id', sa.literal_column('created_at DESC'), sa.literal_column('id DESC')], unique=False)
    op.create_index('ix_tickets_reporter_created_id', 'tickets', ['reporter_id', sa.literal_column('created_at DESC'), sa.literal_column('id DESC')], unique=False)
    op.create_index('ix_tickets_status_created_id', 'tickets', ['status', sa.literal_column('created_at DESC'), sa.literal_column('id DESC')], unique=False)
    op.create_table('assignments',
    sa.Column('ticket_id', sa.BigInteger(), nullable=False),
    sa.Column('technician_id', sa.BigInteger(), nullable=False),
    sa.Column('assigned_by', sa.BigInteger(), nullable=False),
    sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.ForeignKeyConstraint(['assigned_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['technician_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_assignments_assigned_by', 'assignments', ['assigned_by'], unique=False)
    op.create_index('ix_assignments_technician_id', 'assignments', ['technician_id'], unique=False)
    op.create_index('ix_assignments_ticket_id', 'assignments', ['ticket_id'], unique=False)
    op.create_index('uq_assignments_current_ticket', 'assignments', ['ticket_id'], unique=True, postgresql_where=sa.text('ended_at IS NULL'))
    op.create_table('attachments',
    sa.Column('ticket_id', sa.BigInteger(), nullable=False),
    sa.Column('uploader_id', sa.BigInteger(), nullable=False),
    sa.Column('storage_key', sa.Text(), nullable=False),
    sa.Column('original_name', sa.Text(), nullable=False),
    sa.Column('mime', sa.Text(), nullable=False),
    sa.Column('size', sa.BigInteger(), nullable=False),
    sa.Column('purpose', sa.Text(), nullable=False),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.CheckConstraint("purpose IN ('REPORT_PHOTO', 'RESOLUTION_PHOTO')", name='ck_attachments_purpose'),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ),
    sa.ForeignKeyConstraint(['uploader_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('storage_key', name='uq_attachments_storage_key')
    )
    op.create_index('ix_attachments_ticket_id', 'attachments', ['ticket_id'], unique=False)
    op.create_index('ix_attachments_uploader_id', 'attachments', ['uploader_id'], unique=False)
    op.create_table('comments',
    sa.Column('ticket_id', sa.BigInteger(), nullable=False),
    sa.Column('author_id', sa.BigInteger(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('visibility', sa.Text(), nullable=False),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.CheckConstraint("visibility IN ('PUBLIC', 'ADMIN_ONLY')", name='ck_comments_visibility'),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_comments_ticket_created_id', 'comments', ['ticket_id', 'created_at', 'id'], unique=False)
    op.create_table('ticket_events',
    sa.Column('ticket_id', sa.BigInteger(), nullable=False),
    sa.Column('actor_id', sa.BigInteger(), nullable=False),
    sa.Column('type', sa.Text(), nullable=False),
    sa.Column('from_status', sa.Text(), nullable=True),
    sa.Column('to_status', sa.Text(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('visibility', sa.Text(), nullable=False),
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.CheckConstraint("visibility IN ('PUBLIC', 'ADMIN_ONLY')", name='ck_ticket_events_visibility'),
    sa.CheckConstraint("from_status IS NULL OR from_status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED')", name='ck_ticket_events_from_status'),
    sa.CheckConstraint("to_status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED')", name='ck_ticket_events_to_status'),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ticket_events_ticket_created_id', 'ticket_events', ['ticket_id', 'created_at', 'id'], unique=False)


def downgrade():
    # Destructive rollback for isolated test/demo databases only.
    op.drop_index('ix_ticket_events_ticket_created_id', table_name='ticket_events')
    op.drop_table('ticket_events')
    op.drop_index('ix_comments_ticket_created_id', table_name='comments')
    op.drop_table('comments')
    op.drop_index('ix_attachments_uploader_id', table_name='attachments')
    op.drop_index('ix_attachments_ticket_id', table_name='attachments')
    op.drop_table('attachments')
    op.drop_index('uq_assignments_current_ticket', table_name='assignments', postgresql_where=sa.text('ended_at IS NULL'))
    op.drop_index('ix_assignments_ticket_id', table_name='assignments')
    op.drop_index('ix_assignments_technician_id', table_name='assignments')
    op.drop_index('ix_assignments_assigned_by', table_name='assignments')
    op.drop_table('assignments')
    op.drop_index('ix_tickets_status_created_id', table_name='tickets')
    op.drop_index('ix_tickets_reporter_created_id', table_name='tickets')
    op.drop_index('ix_tickets_location_created_id', table_name='tickets')
    op.drop_index('ix_tickets_assignee_created_id', table_name='tickets')
    op.drop_table('tickets')
    op.drop_index('ix_sessions_user_id', table_name='sessions')
    op.drop_table('sessions')
    op.drop_table('users')
    op.drop_table('locations')
