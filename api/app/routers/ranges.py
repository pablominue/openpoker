"""Preflop ranges management: hero ranges CRUD, deviation stats, villain estimation."""

import re
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.deps import get_db
from db.models import Hand, PlayerRange

logger = logging.getLogger("RANGES")

router = APIRouter(prefix="/api/ranges", tags=["ranges"])

# ─── Position constants ───────────────────────────────────────────────────────

POSITIONS = ["EP", "HJ", "CO", "BTN", "SB", "BB"]
_POSITIONS_6MAX = ["BTN", "SB", "BB", "EP", "HJ", "CO"]  # seat-relative order

# All scenario definitions: (key, label, category)
SCENARIOS: list[tuple[str, str, str]] = [
    # Open raises
    ("open_EP",  "EP Open",  "Opens"),
    ("open_HJ",  "HJ Open",  "Opens"),
    ("open_CO",  "CO Open",  "Opens"),
    ("open_BTN", "BTN Open", "Opens"),
    ("open_SB",  "SB Open",  "Opens"),
    # vs EP
    ("3bet_HJ_vs_EP",  "HJ 3-Bet vs EP",  "vs EP"),
    ("call_HJ_vs_EP",  "HJ Call vs EP",   "vs EP"),
    ("3bet_CO_vs_EP",  "CO 3-Bet vs EP",  "vs EP"),
    ("call_CO_vs_EP",  "CO Call vs EP",   "vs EP"),
    ("3bet_BTN_vs_EP", "BTN 3-Bet vs EP", "vs EP"),
    ("call_BTN_vs_EP", "BTN Call vs EP",  "vs EP"),
    ("3bet_SB_vs_EP",  "SB 3-Bet vs EP",  "vs EP"),
    ("call_SB_vs_EP",  "SB Call vs EP",   "vs EP"),
    ("3bet_BB_vs_EP",  "BB 3-Bet vs EP",  "vs EP"),
    ("call_BB_vs_EP",  "BB Call vs EP",   "vs EP"),
    # vs HJ
    ("3bet_CO_vs_HJ",  "CO 3-Bet vs HJ",  "vs HJ"),
    ("call_CO_vs_HJ",  "CO Call vs HJ",   "vs HJ"),
    ("3bet_BTN_vs_HJ", "BTN 3-Bet vs HJ", "vs HJ"),
    ("call_BTN_vs_HJ", "BTN Call vs HJ",  "vs HJ"),
    ("3bet_SB_vs_HJ",  "SB 3-Bet vs HJ",  "vs HJ"),
    ("call_SB_vs_HJ",  "SB Call vs HJ",   "vs HJ"),
    ("3bet_BB_vs_HJ",  "BB 3-Bet vs HJ",  "vs HJ"),
    ("call_BB_vs_HJ",  "BB Call vs HJ",   "vs HJ"),
    # vs CO
    ("3bet_BTN_vs_CO", "BTN 3-Bet vs CO", "vs CO"),
    ("call_BTN_vs_CO", "BTN Call vs CO",  "vs CO"),
    ("3bet_SB_vs_CO",  "SB 3-Bet vs CO",  "vs CO"),
    ("call_SB_vs_CO",  "SB Call vs CO",   "vs CO"),
    ("3bet_BB_vs_CO",  "BB 3-Bet vs CO",  "vs CO"),
    ("call_BB_vs_CO",  "BB Call vs CO",   "vs CO"),
    # vs BTN
    ("3bet_SB_vs_BTN", "SB 3-Bet vs BTN", "vs BTN"),
    ("call_SB_vs_BTN", "SB Call vs BTN",  "vs BTN"),
    ("3bet_BB_vs_BTN", "BB 3-Bet vs BTN", "vs BTN"),
    ("call_BB_vs_BTN", "BB Call vs BTN",  "vs BTN"),
    # vs SB
    ("3bet_BB_vs_SB",  "BB 3-Bet vs SB",  "vs SB"),
    ("call_BB_vs_SB",  "BB Call vs SB",   "vs SB"),
]

SCENARIO_MAP = {key: label for key, label, _ in SCENARIOS}

# ─── Default GTO-approximate ranges ──────────────────────────────────────────
# Standard 6-max NL 100bb ranges (commonly used in training)

DEFAULT_RANGES: dict[str, str] = {
    # ── Opens ──
    "open_EP": (
        "AA,KK,QQ,JJ,TT,99,88,"
        "AKs,AQs,AJs,ATs,A9s,A5s,A4s,A3s,A2s,"
        "KQs,KJs,QJs,JTs,T9s,"
        "AKo,AQo"
    ),
    "open_HJ": (
        "AA,KK,QQ,JJ,TT,99,88,77,"
        "AKs,AQs,AJs,ATs,A9s,A8s,A5s,A4s,A3s,A2s,"
        "KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,"
        "AKo,AQo,AJo,KQo"
    ),
    "open_CO": (
        "AA,KK,QQ,JJ,TT,99,88,77,66,55,"
        "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
        "KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,76s,65s,"
        "AKo,AQo,AJo,ATo,KQo,KJo"
    ),
    "open_BTN": (
        "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
        "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
        "KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,K4s,K3s,K2s,"
        "QJs,QTs,Q9s,Q8s,Q7s,JTs,J9s,J8s,J7s,"
        "T9s,T8s,T7s,98s,97s,96s,87s,86s,76s,75s,65s,64s,54s,43s,"
        "AKo,AQo,AJo,ATo,A9o,KQo,KJo,KTo,QJo,QTo,JTo"
    ),
    "open_SB": (
        "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
        "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
        "KQs,KJs,KTs,K9s,K8s,K7s,QJs,QTs,Q9s,Q8s,"
        "JTs,J9s,J8s,T9s,T8s,98s,97s,87s,86s,76s,65s,54s,"
        "AKo,AQo,AJo,ATo,KQo,KJo,KTo,QJo"
    ),
    # ── 3-bets ──
    "3bet_HJ_vs_EP":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,A5s,A4s,AKo,AQo:0.5",
    "3bet_CO_vs_EP":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs:0.5,A5s,A4s,A3s,AKo,AQo:0.5",
    "3bet_BTN_vs_EP": "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs:0.5,A5s,A4s,A3s,A2s,KQs:0.5,AKo,AQo",
    "3bet_SB_vs_EP":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,A5s,A4s,A3s,A2s,AKo,AQo:0.5",
    "3bet_BB_vs_EP":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs:0.5,A5s,A4s,A3s,A2s,KQs:0.5,AKo,AQo,AJo:0.25",
    "3bet_CO_vs_HJ":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs:0.5,A5s,A4s,A3s,KQs:0.5,AKo,AQo",
    "3bet_BTN_vs_HJ": "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs,A5s,A4s,A3s,A2s,KQs:0.5,QJs:0.5,AKo,AQo,AJo:0.5",
    "3bet_SB_vs_HJ":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs:0.5,A5s,A4s,A3s,A2s,AKo,AQo:0.5",
    "3bet_BB_vs_HJ":  "AA,KK,QQ,JJ,TT,99:0.5,AKs,AQs,AJs,A5s,A4s,A3s,A2s,KQs:0.5,AKo,AQo,AJo:0.5",
    "3bet_BTN_vs_CO": "AA,KK,QQ,JJ,TT,99:0.5,AKs,AQs,AJs,A5s,A4s,A3s,A2s,KQs,QJs:0.5,AKo,AQo,AJo:0.5",
    "3bet_SB_vs_CO":  "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs:0.5,A5s,A4s,A3s,A2s,AKo,AQo",
    "3bet_BB_vs_CO":  "AA,KK,QQ,JJ,TT,99:0.5,AKs,AQs,AJs,A5s,A4s,A3s,A2s,KQs:0.5,AKo,AQo,AJo",
    "3bet_SB_vs_BTN": "AA,KK,QQ,JJ,TT,99:0.5,AKs,AQs,AJs,A5s,A4s,A3s,A2s,KQs:0.5,AKo,AQo,AJo:0.5",
    "3bet_BB_vs_BTN": "AA,KK,QQ,JJ,TT,99,88:0.5,AKs,AQs,AJs,ATs:0.5,A5s,A4s,A3s,A2s,KQs,QJs:0.5,AKo,AQo,AJo",
    "3bet_BB_vs_SB":  "AA,KK,QQ,JJ,TT,99,88:0.5,AKs,AQs,AJs,A5s,A4s,A3s,A2s,KQs:0.5,AKo,AQo,AJo:0.5",
    # ── Calls ──
    "call_HJ_vs_EP":  "QQ:0.5,JJ,TT,99,88,77,AQs:0.5,AJs,ATs,A9s,KQs,KJs,QJs,JTs,T9s,98s,AJo:0.5",
    "call_CO_vs_EP":  "QQ:0.5,JJ,TT,99,88,77,66,AQs:0.5,AJs,ATs,A9s,A8s,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,AJo:0.5,ATo:0.5,KQo:0.5",
    "call_BTN_vs_EP": "QQ:0.5,JJ,TT,99,88,77,66,55,AQs:0.5,AJs,ATs,A9s,A8s,A7s,A6s,KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,76s,65s,AJo:0.5,ATo,KQo,KJo:0.5",
    "call_SB_vs_EP":  "QQ:0.5,JJ,TT,99,88,77,AQs:0.5,AJs,ATs,A9s,KQs,KJs,QJs,JTs,T9s,AJo:0.5",
    "call_BB_vs_EP":  "QQ:0.5,JJ,TT,99,88,77,66,55,44,AQs:0.5,AJs,ATs,A9s,A8s,A7s,A6s,A5s,KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,76s,65s,54s,AJo,ATo:0.5,KQo,KJo:0.5",
    "call_CO_vs_HJ":  "QQ:0.5,JJ,TT,99,88,77,66,AJs,ATs,A9s,A8s,KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,87s,76s,ATo:0.5,KQo:0.5",
    "call_BTN_vs_HJ": "QQ:0.5,JJ,TT,99,88,77,66,55,AJs,ATs,A9s,A8s,A7s,A6s,KQs,KJs,KTs,K9s,K8s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,76s,65s,ATo,KQo,KJo:0.5",
    "call_SB_vs_HJ":  "QQ:0.5,JJ,TT,99,88,77,AJs,ATs,A9s,KQs,KJs,QJs,JTs,T9s,98s",
    "call_BB_vs_HJ":  "QQ:0.5,JJ,TT,99,88,77,66,55,44,33,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQs,KJs,KTs,K9s,K8s,QJs,QTs,Q9s,J9s,JTs,T9s,T8s,98s,97s,87s,76s,65s,54s,ATo,KQo,KJo",
    "call_BTN_vs_CO": "JJ,TT,99,88,77,66,55,44,ATs,A9s,A8s,A7s,A6s,KQs,KJs,KTs,K9s,K8s,QJs,QTs,Q9s,Q8s,JTs,J9s,J8s,T9s,T8s,98s,97s,87s,86s,76s,75s,65s,AJo:0.5,ATo,KQo,KJo,QJo:0.5",
    "call_SB_vs_CO":  "JJ,TT,99,88,77,ATs,A9s,A8s,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s",
    "call_BB_vs_CO":  "JJ,TT,99,88,77,66,55,44,33,22,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQs,KJs,KTs,K9s,K8s,K7s,QJs,QTs,Q9s,Q8s,JTs,J9s,J8s,T9s,T8s,98s,97s,87s,76s,65s,54s,ATo,KQo,KJo,QJo",
    "call_SB_vs_BTN": "TT,99,88,77,66,A9s,A8s,A7s,A6s,KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s",
    "call_BB_vs_BTN": "99,88,77,66,55,44,33,22,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQs,KJs,KTs,K9s,K8s,K7s,K6s,QJs,QTs,Q9s,Q8s,Q7s,JTs,J9s,J8s,J7s,T9s,T8s,T7s,98s,97s,96s,87s,86s,76s,75s,65s,64s,54s,43s,ATo,A9o,KQo,KJo,KTo,QJo,QTo,JTo",
    "call_BB_vs_SB":  "99,88,77,66,55,44,33,22,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQs,KJs,KTs,K9s,K8s,K7s,QJs,QTs,Q9s,Q8s,JTs,J9s,J8s,T9s,T8s,98s,97s,87s,76s,65s,ATo,KQo,KJo,KTo:0.5,QJo,QTo:0.5",
}

# ─── Schemas ──────────────────────────────────────────────────────────────────

class RangeEntry(BaseModel):
    scenario_key: str
    scenario_label: str
    category: str
    range_str: str
    is_default: bool   # True if not saved by user yet


class RangeSaveRequest(BaseModel):
    range_str: str


class DeviationRow(BaseModel):
    scenario_key: str
    scenario_label: str
    hands_played: int        # times hero played this action
    in_range_count: int      # hands where cards were inside defined range
    adherence_pct: float     # in_range_count / hands_played * 100


class VillainPositionStat(BaseModel):
    position: str
    total_hands: int
    vpip: int
    pfr: int
    three_bet: int
    vpip_pct: float
    pfr_pct: float
    three_bet_pct: float
    estimated_range: str


class VillainStatsResponse(BaseModel):
    villain_name: str
    total_hands_sampled: int
    positions: list[VillainPositionStat]


# ─── Range helpers ────────────────────────────────────────────────────────────

RANKS = list("AKQJT98765432")
RANK_IDX = {r: i for i, r in enumerate(RANKS)}


def hole_cards_to_range_key(hole_cards: str) -> str:
    """Convert '4-char hole cards like 'AhKs' to range key 'AKs'/'AKo'/'AA'."""
    if not hole_cards or len(hole_cards) != 4:
        return ""
    r1, s1, r2, s2 = hole_cards[0], hole_cards[1], hole_cards[2], hole_cards[3]
    if r1 not in RANK_IDX or r2 not in RANK_IDX:
        return ""
    if r1 == r2:
        return f"{r1}{r2}"
    # Higher rank first
    if RANK_IDX[r1] < RANK_IDX[r2]:
        high, low = r1, r2
    else:
        high, low = r2, r1
    suffix = "s" if s1 == s2 else "o"
    return f"{high}{low}{suffix}"


def range_str_to_set(range_str: str) -> dict[str, float]:
    """Parse range string to {hand_key: frequency}. Only 1.0-frequency hands included fully."""
    result: dict[str, float] = {}
    if not range_str:
        return result
    for token in range_str.split(","):
        token = token.strip()
        if not token:
            continue
        if ":" in token:
            hand, freq_str = token.split(":", 1)
            result[hand.strip()] = float(freq_str)
        else:
            result[token] = 1.0
    return result


def is_in_range(hole_cards: str, range_str: str) -> bool:
    """Check if hole cards are included in the range (freq > 0)."""
    key = hole_cards_to_range_key(hole_cards)
    if not key:
        return False
    rng = range_str_to_set(range_str)
    return rng.get(key, 0.0) > 0


# ─── Villain parsing helpers ──────────────────────────────────────────────────

_RE_TABLE = re.compile(r"Table '([^']+)' (?:6-max )?Seat #(\d+) is the button")
_RE_SEAT = re.compile(r"Seat (\d+): ([^\s(]+)(?:\s+\([€$£]?[\d.]+ in chips\))?")
_RE_ACTION_LINE = re.compile(
    r"^([^\s:]+): (folds|checks|calls|bets|raises|is all-in)",
    re.MULTILINE,
)
_RE_HOLE_CARDS_MARKER = re.compile(r"\*\*\* HOLE CARDS \*\*\*")
_RE_FLOP_MARKER = re.compile(r"\*\*\* FLOP \*\*\*")
_RE_THREE_BET = re.compile(r"raises", re.IGNORECASE)


def _derive_position(seat_num: int, btn_seat: int, total_seats: int) -> str:
    rel = (seat_num - btn_seat) % total_seats
    labels = _POSITIONS_6MAX[:total_seats]
    return labels[rel] if rel < len(labels) else f"S{seat_num}"


def extract_villain_data(raw_text: str, villain_name: str) -> Optional[dict]:
    """
    Parse a hand's raw text and extract villain's position + preflop action.
    Returns dict with keys: position, action (folds/calls/raises), is_3bet
    or None if villain not found.
    """
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")

    table_m = _RE_TABLE.search(text)
    if not table_m:
        return None
    btn_seat = int(table_m.group(2))

    # Parse seats up to hole cards section
    hole_marker_m = _RE_HOLE_CARDS_MARKER.search(text)
    seat_section = text[: hole_marker_m.start()] if hole_marker_m else text
    seats: dict[int, str] = {}
    for m in _RE_SEAT.finditer(seat_section):
        seat_num = int(m.group(1))
        player = m.group(2)
        seats[seat_num] = player

    if villain_name not in seats.values():
        return None

    villain_seat = next(k for k, v in seats.items() if v == villain_name)
    total_seats = len(seats)
    position = _derive_position(villain_seat, btn_seat, total_seats)

    # Extract preflop section (between HOLE CARDS and FLOP)
    if not hole_marker_m:
        return None
    flop_m = _RE_FLOP_MARKER.search(text)
    preflop_end = flop_m.start() if flop_m else len(text)
    preflop_section = text[hole_marker_m.start():preflop_end]

    # Find villain's first preflop action; track if there was a prior raise (making theirs a 3-bet)
    prior_raise = False
    for m in _RE_ACTION_LINE.finditer(preflop_section):
        player = m.group(1)
        action = m.group(2)
        if player != villain_name and action == "raises":
            prior_raise = True
        if player == villain_name:
            is_3bet = action == "raises" and prior_raise
            return {
                "position": position,
                "action": action,
                "is_3bet": is_3bet,
                "vpip": action in ("calls", "bets", "raises", "is all-in"),
                "pfr": action == "raises",
            }

    # Villain folded without acting (blind who folded)
    return {"position": position, "action": "folds", "is_3bet": False, "vpip": False, "pfr": False}


# ─── Range estimation from stats ─────────────────────────────────────────────

# Hand equity ranking — top N% mapping to range string (approximate)
# Each entry: (cumulative_pct, range_str_additions)
_HAND_TIERS = [
    (5,  "AA,KK,QQ,AKs,AKo"),
    (8,  "JJ,AQs,AQo"),
    (10, "TT,AJs,KQs"),
    (13, "99,ATs,KJs,QJs,AJo"),
    (16, "88,A9s,KTs,QTs,JTs,KQo"),
    (20, "77,A8s,A7s,A6s,A5s,K9s,Q9s,J9s,T9s,ATo"),
    (25, "66,A4s,A3s,A2s,K8s,Q8s,J8s,T8s,98s,KJo"),
    (30, "55,K7s,K6s,Q7s,J7s,97s,87s,76s,AJo"),
    (35, "44,K5s,K4s,Q6s,J6s,86s,75s,65s,QJo"),
    (40, "33,K3s,K2s,Q5s,96s,85s,74s,64s,54s,KTo"),
    (45, "22,Q4s,Q3s,Q2s,95s,84s,73s,63s,53s,43s,QTo"),
    (50, "J5s,J4s,J3s,94s,83s,72s,62s,52s,42s,JTo,KJo:0.5"),
]


def estimate_range_from_pct(vpip_pct: float) -> str:
    """Map a VPIP percentage to an estimated range string."""
    parts: list[str] = []
    for threshold, hands in _HAND_TIERS:
        parts.extend(hands.split(","))
        if vpip_pct <= threshold:
            break
    return ",".join(parts)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[RangeEntry])
async def get_ranges(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Return all scenario ranges for a player, using defaults for unset ones."""
    result = await db.execute(
        select(PlayerRange).where(PlayerRange.player_name == player_name)
    )
    saved = {row.scenario_key: row.range_str for row in result.scalars().all()}

    entries: list[RangeEntry] = []
    for key, label, category in SCENARIOS:
        if key in saved:
            entries.append(RangeEntry(
                scenario_key=key, scenario_label=label, category=category,
                range_str=saved[key], is_default=False,
            ))
        else:
            entries.append(RangeEntry(
                scenario_key=key, scenario_label=label, category=category,
                range_str=DEFAULT_RANGES.get(key, ""), is_default=True,
            ))
    return entries


@router.put("/{scenario_key}", response_model=RangeEntry)
async def save_range(
    scenario_key: str,
    body: RangeSaveRequest,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Upsert a range for the given scenario key."""
    label = SCENARIO_MAP.get(scenario_key, scenario_key)
    category = next((cat for key, _, cat in SCENARIOS if key == scenario_key), "Other")

    stmt = pg_insert(PlayerRange).values(
        id=__import__("uuid").uuid4(),
        player_name=player_name,
        scenario_key=scenario_key,
        scenario_label=label,
        range_str=body.range_str,
    ).on_conflict_do_update(
        constraint="uq_player_scenario",
        set_={"range_str": body.range_str, "scenario_label": label},
    )
    await db.execute(stmt)
    await db.commit()

    return RangeEntry(
        scenario_key=scenario_key, scenario_label=label, category=category,
        range_str=body.range_str, is_default=False,
    )


@router.delete("/{scenario_key}")
async def reset_range(
    scenario_key: str,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved range (resets to default)."""
    result = await db.execute(
        select(PlayerRange).where(
            PlayerRange.player_name == player_name,
            PlayerRange.scenario_key == scenario_key,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    return {"reset": True}


@router.get("/deviation", response_model=list[DeviationRow])
async def get_deviation(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Compare the player's actual hand history against their defined ranges.
    Returns per-scenario deviation stats.
    """
    # Fetch all hands with hole cards for this player
    result = await db.execute(
        select(
            Hand.hero_position,
            Hand.hero_hole_cards,
            Hand.pfr,
            Hand.three_bet,
            Hand.vpip,
            Hand.three_bet_opportunity,
        ).where(
            Hand.player_name == player_name,
            Hand.hero_hole_cards.isnot(None),
            Hand.hero_position.isnot(None),
        )
    )
    hands = result.all()

    # Fetch saved ranges (fall back to defaults for unset)
    range_result = await db.execute(
        select(PlayerRange).where(PlayerRange.player_name == player_name)
    )
    saved_ranges = {row.scenario_key: row.range_str for row in range_result.scalars().all()}

    def get_range(key: str) -> str:
        return saved_ranges.get(key, DEFAULT_RANGES.get(key, ""))

    # Counters: scenario_key -> {played: int, in_range: int}
    stats: dict[str, dict[str, int]] = {}

    for h_pos, h_cards, h_pfr, h_3bet, h_vpip, h_3bet_opp in hands:
        if not h_pos or not h_cards:
            continue

        # ── Open raise ──
        if h_pfr and not h_3bet:
            key = f"open_{h_pos}"
            if key in SCENARIO_MAP:
                if key not in stats:
                    stats[key] = {"played": 0, "in_range": 0}
                stats[key]["played"] += 1
                if is_in_range(h_cards, get_range(key)):
                    stats[key]["in_range"] += 1

        # ── 3-bet ──
        if h_3bet:
            # We don't always know the raiser position from stored data alone;
            # approximate by checking all 3-bet scenarios for this position.
            matching_keys = [k for k, _, _ in SCENARIOS if k.startswith(f"3bet_{h_pos}_vs_")]
            for key in matching_keys:
                if key not in stats:
                    stats[key] = {"played": 0, "in_range": 0}
                stats[key]["played"] += 1
                if is_in_range(h_cards, get_range(key)):
                    stats[key]["in_range"] += 1
                break  # count only once, first matching scenario

        # ── Call (vpip but not pfr) ──
        if h_vpip and not h_pfr and not h_3bet_opp:
            matching_keys = [k for k, _, _ in SCENARIOS if k.startswith(f"call_{h_pos}_vs_")]
            for key in matching_keys:
                if key not in stats:
                    stats[key] = {"played": 0, "in_range": 0}
                stats[key]["played"] += 1
                if is_in_range(h_cards, get_range(key)):
                    stats[key]["in_range"] += 1
                break

    rows: list[DeviationRow] = []
    for key, label, _ in SCENARIOS:
        if key in stats and stats[key]["played"] > 0:
            played = stats[key]["played"]
            in_rng = stats[key]["in_range"]
            rows.append(DeviationRow(
                scenario_key=key,
                scenario_label=label,
                hands_played=played,
                in_range_count=in_rng,
                adherence_pct=round(in_rng / played * 100, 1),
            ))

    return rows


@router.get("/villain/{villain_name}/stats", response_model=VillainStatsResponse)
async def get_villain_stats(
    villain_name: str,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Estimate villain's preflop tendencies by parsing raw hand history.
    Computes per-position VPIP/PFR/3-bet counts and maps to estimated ranges.
    """
    # Get all hands with raw_text for this hero-player
    result = await db.execute(
        select(Hand.raw_text).where(
            Hand.player_name == player_name,
            Hand.raw_text.isnot(None),
        ).limit(2000)  # cap to avoid very slow parsing
    )
    raw_texts = [r for (r,) in result.all() if r]

    # Per-position aggregation
    pos_agg: dict[str, dict[str, int]] = {}  # position -> {total, vpip, pfr, three_bet}

    total_sampled = 0
    for raw_text in raw_texts:
        data = extract_villain_data(raw_text, villain_name)
        if data is None:
            continue
        total_sampled += 1
        pos = data["position"]
        if pos not in pos_agg:
            pos_agg[pos] = {"total": 0, "vpip": 0, "pfr": 0, "three_bet": 0}
        pos_agg[pos]["total"] += 1
        if data["vpip"]:
            pos_agg[pos]["vpip"] += 1
        if data["pfr"]:
            pos_agg[pos]["pfr"] += 1
        if data["is_3bet"]:
            pos_agg[pos]["three_bet"] += 1

    position_stats: list[VillainPositionStat] = []
    for pos in POSITIONS:
        if pos not in pos_agg:
            continue
        agg = pos_agg[pos]
        total = agg["total"]
        if total == 0:
            continue
        vpip_pct = round(agg["vpip"] / total * 100, 1)
        pfr_pct = round(agg["pfr"] / total * 100, 1)
        tbet_pct = round(agg["three_bet"] / total * 100, 1)
        est_range = estimate_range_from_pct(vpip_pct)

        position_stats.append(VillainPositionStat(
            position=pos,
            total_hands=total,
            vpip=agg["vpip"],
            pfr=agg["pfr"],
            three_bet=agg["three_bet"],
            vpip_pct=vpip_pct,
            pfr_pct=pfr_pct,
            three_bet_pct=tbet_pct,
            estimated_range=est_range,
        ))

    return VillainStatsResponse(
        villain_name=villain_name,
        total_hands_sampled=total_sampled,
        positions=position_stats,
    )
