"""Hand history upload, retrieval and stats endpoints."""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from itertools import permutations
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy import case, cast, delete, distinct, func, select, Integer, and_
from sqlalchemy.ext.asyncio import AsyncSession

from config_renderer import render_config
from core.deps import get_db
from db.base import AsyncSessionLocal
from db.models import Hand, TrainerSpot
from models import BetSizeConfig, SolveRequest
from parsers.pokerstars import parse_file, parse_hand
import solver as solver_service
from trainer_spots import (
    _BTN_OPEN, _BB_DEFEND_VS_BTN,
    _CO_OPEN, _BB_DEFEND_VS_CO,
    _HJ_OPEN, _BB_DEFEND_VS_HJ,
    _SB_OPEN, _BB_DEFEND_VS_SB,
    _STD_BET_SIZES,
    _SRP_POT, _SRP_STACK, _THREE_BET_POT, _THREE_BET_STACK,
)

logger = logging.getLogger("HANDS")
LIBRARY_DIR = Path("/app/jobs/library")

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
    wssd_pct: float      # Won $ at Showdown
    wwsf_pct: float      # Won When Saw Flop
    af: float            # Aggression Factor (postflop bets+raises / calls)
    cbet_pct: float      # C-bet %


class PositionStats(BaseModel):
    position: str
    hands: int
    vpip_pct: float
    pfr_pct: float
    win_rate_bb_100: float


class TimelinePoint(BaseModel):
    played_at: str
    hand_id: str
    result_cents: int
    cumulative_cents: int
    result_bb: float
    cumulative_bb: float


class GTODecision(BaseModel):
    street: str
    hero_action: str                         # "checks", "bets", etc.
    matched_solver_action: Optional[str]     # "CHECK", "BET50", etc.
    gto_actions: list[dict]                  # [{name, gto_freq}]
    hero_gto_freq: float
    grade: str                               # best/correct/inaccuracy/wrong/blunder
    range_strategy: Optional[dict] = None   # full ComboStrategy for this node {combo: [freq0, freq1, ...]}
    action_entries: list[dict] = []          # [{name, index}] ordered action list


class GTOAnalysis(BaseModel):
    status: str = "ready"             # "pending" | "solving" | "failed" | "ready"
    matched_spot_key: Optional[str] = None
    matched_spot_label: Optional[str] = None
    hero_combo: Optional[str] = None
    hero_iso_combo: Optional[str] = None   # canonical solver key (suit-permuted); for strategy lookup
    decisions: list[GTODecision] = []
    note: Optional[str] = None


# ── On-demand solve infrastructure ────────────────────────────────────────────

# Maps matchup_key → (range_ip, range_oop)
_POSITION_RANGES: dict[str, tuple[str, str]] = {
    "BTN_vs_BB": (_BTN_OPEN,        _BB_DEFEND_VS_BTN),
    "CO_vs_BB":  (_CO_OPEN,         _BB_DEFEND_VS_CO),
    "HJ_vs_BB":  (_HJ_OPEN,         _BB_DEFEND_VS_HJ),
    "SB_vs_BB":  (_BB_DEFEND_VS_SB, _SB_OPEN),   # BB is IP, SB is OOP
}


async def _solve_hand_spot(spot_id: object) -> None:
    """Background coroutine: solve an on-demand hand analysis spot."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TrainerSpot).where(TrainerSpot.id == spot_id))
        spot = res.scalar_one_or_none()
        if not spot or spot.solve_status != "pending":
            return
        spot.solve_status = "solving"
        await db.commit()
        spot_key       = spot.spot_key
        spot_board     = spot.board
        spot_pot       = spot.pot
        spot_stack     = spot.effective_stack
        spot_range_ip  = spot.range_ip
        spot_range_oop = spot.range_oop
        spot_bet_sizes = spot.bet_sizes_json

    spot_dir    = LIBRARY_DIR / spot_key
    spot_dir.mkdir(parents=True, exist_ok=True)
    result_file = str(spot_dir / "result.json")
    cfg_path    = spot_dir / "config.txt"

    bet_sizes = [BetSizeConfig(**bs) for bs in spot_bet_sizes]
    req = SolveRequest(
        pot=spot_pot, effective_stack=spot_stack,
        board=spot_board, range_ip=spot_range_ip, range_oop=spot_range_oop,
        bet_sizes=bet_sizes,
        thread_num=2, accuracy=1.0, max_iteration=100,
        dump_rounds=3, allin_threshold=0.67,  # 3 = flop+turn+river
    )
    cfg_path.write_text(render_config(req, result_file))

    try:
        await solver_service.run_solver_path(
            cfg_path=cfg_path, result_file=Path(result_file), work_dir=spot_dir,
        )
        solved_ok = Path(result_file).exists()
    except Exception as exc:
        logger.error("Hand spot %s solve failed: %s", spot_key, exc)
        solved_ok = False

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TrainerSpot).where(TrainerSpot.id == spot_id))
        spot = res.scalar_one_or_none()
        if spot:
            spot.solve_status = "ready" if solved_ok else "failed"
            spot.result_path  = result_file if solved_ok else None
            spot.solved_at    = datetime.now(timezone.utc) if solved_ok else None
            await db.commit()

    if solved_ok:
        _GTO_RESULT_CACHE.pop(spot_key, None)
        logger.info("On-demand hand spot solved: %s", spot_key)
    else:
        logger.warning("On-demand hand spot failed: %s", spot_key)


# ── Filter helpers ─────────────────────────────────────────────────────────────

def _apply_hand_filters(q, position=None, three_bet_pot=None, date_from=None, date_to=None):
    if position:
        q = q.where(Hand.hero_position == position.upper())
    if three_bet_pot:
        q = q.where(Hand.three_bet_opportunity == True)
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            q = q.where(Hand.played_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            q = q.where(Hand.played_at <= dt)
        except ValueError:
            pass
    return q


# ── GTO Analysis utilities (adapted from trainer.py) ──────────────────────────

_GTO_RESULT_CACHE: dict[str, dict] = {}
_SUITS_GTO = ["c", "d", "h", "s"]

# Postflop acting order: leftmost = acts first (most OOP), rightmost = acts last (most IP).
# SB is OOP because it posts the small blind and acts before BB postflop.
# BB acts before EP/HJ/CO/BTN postflop.
_POSTFLOP_POSITION_ORDER = ["SB", "BB", "EP", "HJ", "CO", "BTN"]

# Solved matchup keys available in the trainer spot library.
# Maps (ip_position, oop_position) → matchup_key
_SOLVED_MATCHUPS: dict[tuple[str, str], str] = {
    ("BTN", "BB"): "BTN_vs_BB",
    ("CO",  "BB"): "CO_vs_BB",
    ("HJ",  "BB"): "HJ_vs_BB",
    ("BB",  "SB"): "SB_vs_BB",   # BB is IP vs SB postflop
}


def _get_postflop_role(hero_pos: str, villain_pos: str) -> str:
    """Return 'ip' if hero acts after villain postflop, 'oop' otherwise."""
    order = _POSTFLOP_POSITION_ORDER
    h = order.index(hero_pos) if hero_pos in order else -1
    v = order.index(villain_pos) if villain_pos in order else -1
    if h < 0 or v < 0:
        return "unknown"
    return "ip" if h > v else "oop"


def _resolve_matchup(hero_pos: str) -> Optional[tuple[str, str]]:
    """Return (matchup_key, hero_role) for the best available solved spot, or None.

    IP/OOP is derived from postflop position order, not hardcoded.
    BB defaults to BTN_vs_BB (most common SRP opponent) since the actual
    villain's position is not stored per hand.
    EP has no solved spots and returns None.
    """
    if hero_pos in ("BTN", "CO", "HJ"):
        villain = "BB"
        ip_pos, oop_pos = hero_pos, villain
    elif hero_pos == "SB":
        ip_pos, oop_pos = "BB", "SB"
    elif hero_pos == "BB":
        # Best approximation: assume BTN was the preflop raiser (most common SRP)
        ip_pos, oop_pos = "BTN", "BB"
    else:
        return None  # EP or unknown — no solved spots available

    key = _SOLVED_MATCHUPS.get((ip_pos, oop_pos))
    if key is None:
        return None
    role = _get_postflop_role(hero_pos, oop_pos if hero_pos == ip_pos else ip_pos)
    return key, role


def _load_gto_result(spot: TrainerSpot) -> Optional[dict]:
    key = spot.spot_key
    if key in _GTO_RESULT_CACHE:
        return _GTO_RESULT_CACHE[key]
    if not spot.result_path:
        return None
    path = Path(spot.result_path)
    if not path.exists():
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        _GTO_RESULT_CACHE[key] = data
        return data
    except Exception:
        return None


def _gto_navigate_tree(root: dict, node_path: list[str]) -> Optional[dict]:
    node = root
    for step in node_path:
        ntype = node.get("node_type")
        if ntype == "chance_node":
            children = node.get("dealcards") or {}
        else:
            children = node.get("childrens") or {}
        node = children.get(step)
        if node is None:
            return None
    return node


def _gto_find_iso_combo(strategy: dict, combo: str) -> Optional[str]:
    """Find an isomorphic combo in the strategy (suit permutations + rank order swap)."""
    r1, s1, r2, s2 = combo[0], combo[1], combo[2], combo[3]
    # Try both rank orderings (solver may store AcQc as "AcQc" while hero has "QcAc")
    for (ra, sa, rb, sb) in [(r1, s1, r2, s2), (r2, s2, r1, s1)]:
        for perm in set(permutations(_SUITS_GTO)):
            suit_map = dict(zip(_SUITS_GTO, perm))
            candidate = ra + suit_map[sa] + rb + suit_map[sb]
            if candidate in strategy:
                return candidate
    return None


def _gto_get_action_entries(node: dict) -> list[dict]:
    child_keys = list((node.get("childrens") or {}).keys())
    strategy = node.get("strategy", {}).get("strategy", {})
    if not strategy:
        return [{"name": k, "index": i} for i, k in enumerate(child_keys)]
    sample = next(iter(strategy.values()), [])
    strat_len = len(sample)
    if strat_len == len(child_keys) + 1:
        return [{"name": "FOLD", "index": 0}] + [
            {"name": k, "index": i + 1} for i, k in enumerate(child_keys)
        ]
    return [{"name": k, "index": i} for i, k in enumerate(child_keys)]


def _gto_freq_for_combo(node: dict, hero_combo: str, action_name: str) -> float:
    entries = _gto_get_action_entries(node)
    strategy = node.get("strategy", {}).get("strategy", {})
    if not strategy:
        return 1.0 / max(len(entries), 1)
    entry = next((e for e in entries if e["name"] == action_name), None)
    if entry is None:
        return 0.0
    idx = entry["index"]
    freqs = strategy.get(hero_combo)
    if freqs is None:
        iso = _gto_find_iso_combo(strategy, hero_combo)
        freqs = strategy.get(iso) if iso else None
    if freqs is None:
        all_vals = [v[idx] for v in strategy.values() if len(v) > idx]
        return sum(all_vals) / len(all_vals) if all_vals else 0.0
    return freqs[idx] if idx < len(freqs) else 0.0


def _gto_available_actions(node: dict, hero_combo: str) -> list[dict]:
    entries = _gto_get_action_entries(node)
    return [
        {"name": e["name"], "gto_freq": round(_gto_freq_for_combo(node, hero_combo, e["name"]), 4)}
        for e in entries
    ]


def _map_verb_to_solver(verb: str, children: list[str]) -> Optional[str]:
    """Map a parser action verb to the closest solver tree action key."""
    if verb == "checks":
        return "CHECK" if "CHECK" in children else None
    if verb == "calls":
        return "CALL" if "CALL" in children else None
    if verb == "folds":
        return "FOLD" if "FOLD" in children else None
    if verb in ("bets", "raises"):
        prefix = "BET" if verb == "bets" else "RAISE"
        matches = sorted(c for c in children if c.startswith(prefix))
        return matches[0] if matches else None
    return None


def _grade_action(gto_freq: float) -> str:
    if gto_freq >= 0.75:
        return "best"
    elif gto_freq >= 0.40:
        return "correct"
    elif gto_freq >= 0.15:
        return "inaccuracy"
    elif gto_freq >= 0.05:
        return "wrong"
    else:
        return "blunder"


def _compute_af_cbet(hands_data: list) -> tuple[float, float]:
    """Compute Aggression Factor and C-bet % from (pfr, board, actions_json) rows."""
    bets_raises = 0
    calls = 0
    cbets = 0
    pfr_saw_flop = 0

    for row in hands_data:
        pfr, board, actions_json = row.pfr, row.board, row.actions_json
        if not actions_json:
            continue
        for street in ("flop", "turn", "river"):
            for act in (actions_json.get(street) or []):
                if act.get("is_hero"):
                    verb = act.get("action")
                    if verb in ("bets", "raises"):
                        bets_raises += 1
                    elif verb == "calls":
                        calls += 1
        if pfr and board:
            pfr_saw_flop += 1
            flop_acts = actions_json.get("flop") or []
            first_hero = next((a for a in flop_acts if a.get("is_hero")), None)
            if first_hero and first_hero.get("action") in ("bets", "raises"):
                cbets += 1

    af = round(bets_raises / calls, 2) if calls > 0 else float(bets_raises)
    cbet_pct = round(cbets / pfr_saw_flop * 100.0, 1) if pfr_saw_flop > 0 else 0.0
    return af, cbet_pct


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
    """Re-parses every hand that has raw_text stored, updating hero_result and stats columns."""
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
    three_bet_pot: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    min_pot: Optional[int] = Query(None, description="Minimum total pot in cents"),
    max_pot: Optional[int] = Query(None, description="Maximum total pot in cents"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Hand).where(Hand.player_name == player_name)
    q = _apply_hand_filters(q, position, three_bet_pot, date_from, date_to)
    if min_pot is not None:
        q = q.where(Hand.pot_total >= min_pot)
    if max_pot is not None:
        q = q.where(Hand.pot_total <= max_pot)
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
    position: Optional[str] = Query(None),
    three_bet_pot: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> StatsSummary:
    # Build the filtered subquery to reuse across all aggregations
    base_q = select(Hand.id).where(Hand.player_name == player_name)
    base_q = _apply_hand_filters(base_q, position, three_bet_pot, date_from, date_to)
    sub = base_q.subquery()

    agg_result = await db.execute(
        select(
            func.count().label("total"),
            func.sum(cast(Hand.vpip, Integer)).label("vpip_sum"),
            func.sum(cast(Hand.pfr, Integer)).label("pfr_sum"),
            func.sum(cast(Hand.three_bet, Integer)).label("tb_sum"),
            func.sum(cast(Hand.went_to_showdown, Integer)).label("wtsd_sum"),
            func.sum(Hand.hero_result).label("total_result"),
            func.sum(Hand.stakes_bb).label("total_bb"),
            func.sum(
                case((and_(Hand.went_to_showdown == True, Hand.hero_won == True), 1), else_=0)
            ).label("wssd_wins"),
            func.sum(cast(Hand.went_to_showdown, Integer)).label("wssd_total"),
            func.sum(
                case((and_(Hand.board.isnot(None), Hand.hero_won == True), 1), else_=0)
            ).label("wwsf_wins"),
            func.sum(case((Hand.board.isnot(None), 1), else_=0)).label("wwsf_total"),
        ).where(Hand.id.in_(sub))
    )
    row = agg_result.one()
    total = row.total or 0

    if total == 0:
        return StatsSummary(
            total_hands=0, vpip_pct=0, pfr_pct=0, three_bet_pct=0, wtsd_pct=0,
            win_rate_bb_100=0, wssd_pct=0, wwsf_pct=0, af=0.0, cbet_pct=0.0,
        )

    avg_bb = (row.total_bb or 0) / total
    win_rate = ((row.total_result or 0) / (avg_bb * total) * 100) if avg_bb > 0 else 0

    wssd_pct = round((row.wssd_wins or 0) / row.wssd_total * 100, 1) if (row.wssd_total or 0) > 0 else 0.0
    wwsf_pct = round((row.wwsf_wins or 0) / row.wwsf_total * 100, 1) if (row.wwsf_total or 0) > 0 else 0.0

    # AF and C-bet% require scanning actions_json per hand
    af_rows_result = await db.execute(
        select(Hand.pfr, Hand.board, Hand.actions_json).where(Hand.id.in_(sub))
    )
    af, cbet_pct = _compute_af_cbet(list(af_rows_result.all()))

    return StatsSummary(
        total_hands=total,
        vpip_pct=round((row.vpip_sum or 0) / total * 100, 1),
        pfr_pct=round((row.pfr_sum or 0) / total * 100, 1),
        three_bet_pct=round((row.tb_sum or 0) / total * 100, 1),
        wtsd_pct=round((row.wtsd_sum or 0) / total * 100, 1),
        win_rate_bb_100=round(win_rate, 2),
        wssd_pct=wssd_pct,
        wwsf_pct=wwsf_pct,
        af=af,
        cbet_pct=cbet_pct,
    )


@router.get("/stats/by-position", response_model=list[PositionStats])
async def stats_by_position(
    player_name: str = Query(...),
    three_bet_pot: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> list[PositionStats]:
    base_q = select(Hand.id).where(Hand.player_name == player_name, Hand.hero_position.isnot(None))
    base_q = _apply_hand_filters(base_q, None, three_bet_pot, date_from, date_to)
    sub = base_q.subquery()

    result = await db.execute(
        select(
            Hand.hero_position,
            func.count().label("hands"),
            func.sum(cast(Hand.vpip, Integer)).label("vpip_sum"),
            func.sum(cast(Hand.pfr, Integer)).label("pfr_sum"),
            func.sum(Hand.hero_result).label("total_result"),
            func.sum(Hand.stakes_bb).label("total_bb"),
        )
        .where(Hand.id.in_(sub))
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


@router.get("/stats/timeline", response_model=list[TimelinePoint])
async def stats_timeline(
    player_name: str = Query(...),
    position: Optional[str] = Query(None),
    three_bet_pot: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> list[TimelinePoint]:
    q = select(Hand.id, Hand.played_at, Hand.hero_result, Hand.stakes_bb).where(
        Hand.player_name == player_name
    )
    q = _apply_hand_filters(q, position, three_bet_pot, date_from, date_to)
    q = q.order_by(Hand.played_at.asc())

    result = await db.execute(q)
    rows = result.all()

    cumulative_cents = 0
    cumulative_bb = 0.0
    points = []
    for row in rows:
        result_bb = row.hero_result / row.stakes_bb if row.stakes_bb > 0 else 0.0
        cumulative_cents += row.hero_result
        cumulative_bb += result_bb
        points.append(TimelinePoint(
            played_at=row.played_at.isoformat(),
            hand_id=str(row.id),
            result_cents=row.hero_result,
            cumulative_cents=cumulative_cents,
            result_bb=round(result_bb, 2),
            cumulative_bb=round(cumulative_bb, 2),
        ))
    return points


@router.get("/{hand_id}/gto-analysis", response_model=GTOAnalysis)
async def get_hand_gto_analysis(
    hand_id: str,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> GTOAnalysis:
    """Return GTO analysis for a specific hand using the exact board.

    On first call: creates an on-demand TrainerSpot for this exact board + position
    matchup and queues a background solve.  Subsequent calls return the result once ready.
    """
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

    if not hand.hero_position or not hand.hero_hole_cards:
        return GTOAnalysis(note="Hand missing position or hole cards")

    if not hand.board or len(hand.board) < 6:
        return GTOAnalysis(note="Hand missing board data — hand may not have reached the flop")

    pos_upper = hand.hero_position.upper()
    resolved = _resolve_matchup(pos_upper)
    if resolved is None:
        return GTOAnalysis(
            note=f"GTO analysis not available for {hand.hero_position} (no solved spot for this position)"
        )

    matchup_key, hero_role = resolved
    ranges = _POSITION_RANGES.get(matchup_key)
    if ranges is None:
        return GTOAnalysis(note=f"No ranges configured for {matchup_key}")

    # Determine pot type from preflop raise count
    preflop_acts = (hand.actions_json or {}).get("preflop", [])
    raise_count = sum(1 for a in preflop_acts if a.get("action") == "raises")
    is_3bet = raise_count >= 2
    pot_type = "3bet" if is_3bet else "srp"
    pot    = _THREE_BET_POT if is_3bet else _SRP_POT
    stack  = _THREE_BET_STACK if is_3bet else _SRP_STACK

    # Exact flop board
    flop_raw = hand.board[:6]   # e.g. "AcKhQd"
    board_csv = f"{flop_raw[0:2]},{flop_raw[2:4]},{flop_raw[4:6]}"

    # Unique spot key — reused across all hands with the same board+matchup+pot_type.
    # "hd3" prefix means dump_rounds=3 (flop+turn+river); old "hd" spots used dump_rounds=2.
    spot_key = f"hd3_{matchup_key}_{pot_type}_{flop_raw.lower()}"

    # Look up or create the on-demand spot
    spot_res = await db.execute(select(TrainerSpot).where(TrainerSpot.spot_key == spot_key))
    spot = spot_res.scalar_one_or_none()

    if spot is None:
        range_ip, range_oop = ranges
        spot = TrainerSpot(
            spot_key=spot_key,
            label=f"{matchup_key} · {board_csv} ({pot_type.upper()})",
            position_matchup=matchup_key,
            board_texture="on_demand",
            board=board_csv,
            range_ip=range_ip,
            range_oop=range_oop,
            pot=pot,
            effective_stack=stack,
            bet_sizes_json=_STD_BET_SIZES,
            solve_status="pending",
        )
        db.add(spot)
        await db.commit()
        await db.refresh(spot)
        asyncio.create_task(_solve_hand_spot(spot.id))
        logger.info("Queued on-demand solve for spot %s", spot_key)

    if spot.solve_status == "pending":
        asyncio.create_task(_solve_hand_spot(spot.id))  # re-trigger if task died
    if spot.solve_status != "ready":
        return GTOAnalysis(
            status=spot.solve_status,
            matched_spot_key=spot_key,
            matched_spot_label=spot.label,
            note="Solving exact board — please wait a moment and refresh",
        )

    tree = _load_gto_result(spot)
    if not tree:
        return GTOAnalysis(note="Solver result file missing — spot may need re-solving")

    hero_combo   = hand.hero_hole_cards
    actions_json = hand.actions_json or {}
    board        = hand.board or ""

    turn_card  = board[6:8]  if len(board) >= 8  else None
    river_card = board[8:10] if len(board) >= 10 else None

    decisions: list[GTODecision] = []
    node_path: list[str] = []

    for street, street_card in [("flop", None), ("turn", turn_card), ("river", river_card)]:
        street_actions = actions_json.get(street, [])
        if not street_actions:
            break

        current_node = _gto_navigate_tree(tree, node_path)
        if current_node is None:
            break

        # Traverse chance node when entering turn or river
        if street_card and current_node.get("node_type") == "chance_node":
            deal_cards = current_node.get("dealcards", {})
            if not deal_cards:
                # River data absent (old spot solved with dump_rounds=2) → skip river gracefully
                if street == "river":
                    continue
                break
            hero_cards = {hero_combo[:2], hero_combo[2:]}
            if street_card in deal_cards and street_card not in hero_cards:
                node_path.append(street_card)
            else:
                available = [c for c in deal_cards if c not in hero_cards]
                if not available:
                    break
                node_path.append(available[0])
            current_node = _gto_navigate_tree(tree, node_path)
            if current_node is None:
                break

        # Walk through this street's actions
        action_idx = 0
        while action_idx < len(street_actions) and current_node is not None:
            if current_node.get("node_type") != "action_node":
                break

            action_data  = street_actions[action_idx]
            action_idx  += 1
            children     = list((current_node.get("childrens") or {}).keys())
            solver_action = _map_verb_to_solver(action_data["action"], children)

            if action_data["is_hero"]:
                gto_actions  = _gto_available_actions(current_node, hero_combo)
                node_entries = _gto_get_action_entries(current_node)
                hero_gto_freq = (
                    _gto_freq_for_combo(current_node, hero_combo, solver_action)
                    if solver_action else 0.0
                )
                decisions.append(GTODecision(
                    street=street,
                    hero_action=action_data["action"],
                    matched_solver_action=solver_action,
                    gto_actions=gto_actions,
                    hero_gto_freq=round(hero_gto_freq, 4),
                    grade=_grade_action(hero_gto_freq),
                    range_strategy=current_node.get("strategy", {}).get("strategy") or None,
                    action_entries=node_entries,
                ))

            if solver_action and solver_action in children:
                node_path.append(solver_action)
                current_node = _gto_navigate_tree(tree, node_path)
            else:
                break

    # Find the canonical combo key used in the solver strategy (suit permutation may differ)
    hero_iso_combo: Optional[str] = None
    for dec in decisions:
        if dec.range_strategy:
            found = _gto_find_iso_combo(dec.range_strategy, hero_combo)
            if found:
                hero_iso_combo = found
                break

    return GTOAnalysis(
        status="ready",
        matched_spot_key=spot.spot_key,
        matched_spot_label=spot.label,
        hero_combo=hero_combo,
        hero_iso_combo=hero_iso_combo,
        decisions=decisions,
        note=None,
    )


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
