"""SQLAlchemy ORM models."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer,
    SmallInteger, String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    pokerstars_username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    hands: Mapped[list["Hand"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    training_sessions: Mapped[list["TrainingSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Hand(Base):
    __tablename__ = "hands"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    hand_id_raw: Mapped[str] = mapped_column(String(30), nullable=False)
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    stakes_sb: Mapped[int] = mapped_column(Integer, nullable=False)   # in cents
    stakes_bb: Mapped[int] = mapped_column(Integer, nullable=False)
    table_name: Mapped[str] = mapped_column(String(64), nullable=False)
    hero_seat: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    hero_position: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)  # BTN/CO/HJ/EP/SB/BB
    hero_hole_cards: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # "Qh2s"
    board: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    pot_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)   # cents
    rake: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hero_result: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # net cents (signed)
    hero_won: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    went_to_showdown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    vpip: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pfr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    three_bet_opportunity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    three_bet: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    actions_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="hands")


class TrainerSpot(Base):
    __tablename__ = "trainer_spots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spot_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    position_matchup: Mapped[str] = mapped_column(String(32), nullable=False)
    board_texture: Mapped[str] = mapped_column(String(32), nullable=False)
    board: Mapped[str] = mapped_column(String(15), nullable=False)
    range_ip: Mapped[str] = mapped_column(Text, nullable=False)
    range_oop: Mapped[str] = mapped_column(Text, nullable=False)
    pot: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_stack: Mapped[int] = mapped_column(Integer, nullable=False)
    bet_sizes_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    solve_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    job_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    result_path: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    solved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    sessions: Mapped[list["TrainingSession"]] = relationship(back_populates="spot")


class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    spot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trainer_spots.id"), nullable=False)
    hero_combo: Mapped[str] = mapped_column(String(8), nullable=False)
    hero_position: Mapped[str] = mapped_column(String(3), nullable=False)  # "ip" or "oop"
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    gto_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    decisions_json: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    user: Mapped["User"] = relationship(back_populates="training_sessions")
    spot: Mapped["TrainerSpot"] = relationship(back_populates="sessions")
