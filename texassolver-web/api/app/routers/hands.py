"""Hand history upload, retrieval and stats endpoints."""

import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy import cast, delete, distinct, func, select, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from core.deps import get_db
from db.models import Hand
from parsers.pokerstars import parse_file, parse_hand

router = APIRouter(prefix="/api/hands", tags=["hands"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class HandSummary(BaseModel):
    id: str
    hand_id_raw: str
    played_at: str
    stakes_bb: int
    table_name: str
    hero_position: Optional[str]
    hero_hole_cards: Optional[str]
    board: Optional[str]
    hero_result: int
    hero_won: bool
    went_to_showdown: bool
    vpip: bool
    pfr: bool

    model_config = {"from_attributes": True}


class HandDetail(HandSummary):
    actions_json: Optional[dict]
    raw_text: Optional[str]


class UploadResult(BaseModel):
    parsed: int
    skipped: int
    duplicate: int


class StatsSummary(BaseModel):
    total_hands: int
    vpip_pct: float
    pfr_pct: float
    three_bet_pct: float
    wtsd_pct: float
    win_rate_bb_100: float


class PositionStats(BaseModel):
    position: str
    hands: int
    vpip_pct: float
    pfr_pct: float
    win_rate_bb_100: float


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hand_to_summary(h: Hand) -> dict:
    return {
        "id": str(h.id),
        "hand_id_raw": h.hand_id_raw,
        "played_at": h.played_at.isoformat(),
        "stakes_bb": h.stakes_bb,
        "table_name": h.table_name,
        "hero_position": h.hero_position,
        "hero_hole_cards": h.hero_hole_cards,
        "board": h.board,
        "hero_result": h.hero_result,
        "hero_won": h.hero_won,
        "went_to_showdown": h.went_to_showdown,
        "vpip": h.vpip,
        "pfr": h.pfr,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/players", response_model=list[str])
async def list_players(db: AsyncSession = Depends(get_db)) -> list[str]:
    """Return all distinct player names that have uploaded hands."""
    result = await db.execute(select(distinct(Hand.player_name)).order_by(Hand.player_name))
    return [row[0] for row in result.all()]


@router.post("/reprocess", response_model=dict)
async def reprocess_hands(
    player_name: str = Query(..., description="Re-parse all stored raw hand texts with the current parser"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-parses every hand that has raw_text stored, updating hero_result and stats columns.
    Use this after a parser bug-fix to correct existing data without re-uploading files."""
    result = await db.execute(
        select(Hand).where(Hand.player_name == player_name, Hand.raw_text.isnot(None))
    )
    hands = result.scalars().all()

    updated = 0
    for hand in hands:
        parsed = await asyncio.to_thread(parse_hand, hand.raw_text, player_name)
        if parsed is None:
            continue
        hand.hero_result = parsed["hero_result"]
        hand.hero_won = parsed["hero_won"]
        hand.went_to_showdown = parsed["went_to_showdown"]
        hand.vpip = parsed["vpip"]
        hand.pfr = parsed["pfr"]
        hand.three_bet = parsed["three_bet"]
        hand.three_bet_opportunity = parsed["three_bet_opportunity"]
        updated += 1

    await db.commit()
    return {"reprocessed": updated}


@router.post("/upload", response_model=UploadResult)
async def upload_hands(
    file: UploadFile = File(...),
    player_name: str = Query(..., description="PokerStars username of the hero"),
    db: AsyncSession = Depends(get_db),
) -> UploadResult:
    content = await file.read()
    text = content.decode("utf-8", errors="replace")

    parsed_list = await asyncio.to_thread(parse_file, text, player_name)

    existing_result = await db.execute(
        select(Hand.hand_id_raw).where(Hand.player_name == player_name)
    )
    existing_ids = {row[0] for row in existing_result.all()}

    added = 0
    skipped = 0
    duplicates = 0

    for hand_data in parsed_list:
        if hand_data["hand_id_raw"] in existing_ids:
            duplicates += 1
            continue
        if not hand_data.get("hero_hole_cards") and not hand_data.get("hero_position"):
            skipped += 1
            continue

        hand = Hand(player_name=player_name, **{k: v for k, v in hand_data.items()})
        db.add(hand)
        added += 1

    await db.commit()
    return UploadResult(parsed=added, skipped=skipped, duplicate=duplicates)


@router.get("", response_model=dict)
async def list_hands(
    player_name: str = Query(...),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    position: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Hand).where(Hand.player_name == player_name)
    if position:
        q = q.where(Hand.hero_position == position.upper())
    q = q.order_by(Hand.played_at.desc())

    total_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_result.scalar_one()

    q = q.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    hands = result.scalars().all()

    return {
        "hands": [_hand_to_summary(h) for h in hands],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/stats/summary", response_model=StatsSummary)
async def stats_summary(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> StatsSummary:
    result = await db.execute(
        select(
            func.count().label("total"),
            func.sum(cast(Hand.vpip, Integer)).label("vpip_sum"),
            func.sum(cast(Hand.pfr, Integer)).label("pfr_sum"),
            func.sum(cast(Hand.three_bet, Integer)).label("tb_sum"),
            func.sum(cast(Hand.went_to_showdown, Integer)).label("wtsd_sum"),
            func.sum(Hand.hero_result).label("total_result"),
            func.sum(Hand.stakes_bb).label("total_bb"),
        ).where(Hand.player_name == player_name)
    )
    row = result.one()
    total = row.total or 0
    if total == 0:
        return StatsSummary(total_hands=0, vpip_pct=0, pfr_pct=0, three_bet_pct=0, wtsd_pct=0, win_rate_bb_100=0)

    avg_bb = (row.total_bb or 0) / total
    win_rate = ((row.total_result or 0) / (avg_bb * total) * 100) if avg_bb > 0 else 0

    return StatsSummary(
        total_hands=total,
        vpip_pct=round((row.vpip_sum or 0) / total * 100, 1),
        pfr_pct=round((row.pfr_sum or 0) / total * 100, 1),
        three_bet_pct=round((row.tb_sum or 0) / total * 100, 1),
        wtsd_pct=round((row.wtsd_sum or 0) / total * 100, 1),
        win_rate_bb_100=round(win_rate, 2),
    )


@router.get("/stats/by-position", response_model=list[PositionStats])
async def stats_by_position(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> list[PositionStats]:
    result = await db.execute(
        select(
            Hand.hero_position,
            func.count().label("hands"),
            func.sum(cast(Hand.vpip, Integer)).label("vpip_sum"),
            func.sum(cast(Hand.pfr, Integer)).label("pfr_sum"),
            func.sum(Hand.hero_result).label("total_result"),
            func.sum(Hand.stakes_bb).label("total_bb"),
        )
        .where(Hand.player_name == player_name)
        .where(Hand.hero_position.isnot(None))
        .group_by(Hand.hero_position)
        .order_by(Hand.hero_position)
    )
    rows = result.all()
    out = []
    for row in rows:
        total = row.hands
        avg_bb = (row.total_bb or 0) / total if total else 0
        win_rate = ((row.total_result or 0) / (avg_bb * total) * 100) if avg_bb > 0 else 0
        out.append(PositionStats(
            position=row.hero_position,
            hands=total,
            vpip_pct=round((row.vpip_sum or 0) / total * 100, 1),
            pfr_pct=round((row.pfr_sum or 0) / total * 100, 1),
            win_rate_bb_100=round(win_rate, 2),
        ))
    return out


@router.get("/{hand_id}", response_model=HandDetail)
async def get_hand(
    hand_id: str,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> HandDetail:
    try:
        uid = uuid.UUID(hand_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hand id")
    result = await db.execute(
        select(Hand).where(Hand.id == uid, Hand.player_name == player_name)
    )
    hand = result.scalar_one_or_none()
    if not hand:
        raise HTTPException(status_code=404, detail="Hand not found")
    d = _hand_to_summary(hand)
    d["actions_json"] = hand.actions_json
    d["raw_text"] = hand.raw_text
    return HandDetail(**d)


@router.delete("/{hand_id}", status_code=204)
async def delete_hand(
    hand_id: str,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        uid = uuid.UUID(hand_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hand id")
    result = await db.execute(
        delete(Hand).where(Hand.id == uid, Hand.player_name == player_name)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Hand not found")
    await db.commit()
