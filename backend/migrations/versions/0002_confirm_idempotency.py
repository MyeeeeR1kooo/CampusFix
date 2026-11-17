"""Record successful confirmation request identity.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("confirm_idempotency_key", sa.Uuid(), nullable=True))
    op.add_column("tickets", sa.Column("confirm_expected_version", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_tickets_confirm_request_pair", "tickets",
        "(confirm_idempotency_key IS NULL) = (confirm_expected_version IS NULL)",
    )


def downgrade():
    op.drop_constraint("ck_tickets_confirm_request_pair", "tickets", type_="check")
    op.drop_column("tickets", "confirm_expected_version")
    op.drop_column("tickets", "confirm_idempotency_key")
