"""initial_schema

Revision ID: 001_initial
Revises:
Create Date: 2026-02-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("pokerstars_username", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "hands",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hand_id_raw", sa.String(30), nullable=False),
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stakes_sb", sa.Integer(), nullable=False),
        sa.Column("stakes_bb", sa.Integer(), nullable=False),
        sa.Column("table_name", sa.String(64), nullable=False),
        sa.Column("hero_seat", sa.SmallInteger(), nullable=True),
        sa.Column("hero_position", sa.String(3), nullable=True),
        sa.Column("hero_hole_cards", sa.String(10), nullable=True),
        sa.Column("board", sa.String(15), nullable=True),
        sa.Column("pot_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rake", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hero_result", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hero_won", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("went_to_showdown", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("vpip", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("pfr", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("three_bet_opportunity", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("three_bet", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("actions_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hands_user_id", "hands", ["user_id"])
    op.create_index("ix_hands_played_at", "hands", ["played_at"])
    op.create_index("ix_hands_user_played", "hands", ["user_id", "played_at"])

    op.create_table(
        "trainer_spots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("spot_key", sa.String(128), nullable=False),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("position_matchup", sa.String(32), nullable=False),
        sa.Column("board_texture", sa.String(32), nullable=False),
        sa.Column("board", sa.String(15), nullable=False),
        sa.Column("range_ip", sa.Text(), nullable=False),
        sa.Column("range_oop", sa.Text(), nullable=False),
        sa.Column("pot", sa.Integer(), nullable=False),
        sa.Column("effective_stack", sa.Integer(), nullable=False),
        sa.Column("bet_sizes_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("solve_status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("job_id", sa.String(64), nullable=True),
        sa.Column("result_path", sa.String(256), nullable=True),
        sa.Column("solved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trainer_spots_spot_key", "trainer_spots", ["spot_key"], unique=True)

    op.create_table(
        "training_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("spot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hero_combo", sa.String(8), nullable=False),
        sa.Column("hero_position", sa.String(3), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("gto_score", sa.Float(), nullable=True),
        sa.Column("decisions_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["spot_id"], ["trainer_spots.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_training_sessions_user_id", "training_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_table("training_sessions")
    op.drop_table("trainer_spots")
    op.drop_table("hands")
    op.drop_table("users")
