"""Trainer endpoints: spot library, training sessions, GTO scoring."""

import json
import random
import re
import uuid
from datetime import datetime, timezone
from itertools import permutations
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.deps import get_db
from db.models import PlayerSpotStat, TrainerSpot, TrainingSession

router = APIRouter(prefix="/api/trainer", tags=["trainer"])

LIBRARY_DIR = Path("/app/jobs/library")

# Matches a dealt community card in the node path (e.g. "Kh", "2d")
_CARD_PAT = re.compile(r'^[2-9TJQKA][cdhs]$')

# Human-readable preflop scenario per position matchup and hero role
_SCENARIO_CONTEXT: dict[str, dict[str, str]] = {
    "BTN_vs_BB": {
        "ip":  "BTN (you) opens 2.5bb, BB calls. Single-raised pot.",
        "oop": "BTN opens 2.5bb, you call from BB. Single-raised pot.",
    },
    "CO_vs_BB": {
        "ip":  "CO (you) opens 2.5bb, BB calls. Single-raised pot.",
        "oop": "CO opens 2.5bb, you call from BB. Single-raised pot.",
    },
    "SB_vs_BB": {
        "ip":  "SB opens 2.5bb, you call from BB. Single-raised pot.",
        "oop": "SB (you) opens 2.5bb, BB calls. Single-raised pot.",
    },
    "HJ_vs_BB": {
        "ip":  "HJ (you) opens 2.5bb, BB calls. Single-raised pot.",
        "oop": "HJ opens 2.5bb, you call from BB. Single-raised pot.",
    },
    "BTN_vs_SB_3bet": {
        "ip":  "You open 2.5bb from BTN, SB 3-bets to 9bb, you call. 3-bet pot.",
        "oop": "BTN opens 2.5bb, you 3-bet to 9bb from SB, BTN calls. 3-bet pot.",
    },
    "CO_vs_BB_3bet": {
        "ip":  "You open 2.5bb from CO, BB 3-bets to 9bb, you call. 3-bet pot.",
        "oop": "CO opens 2.5bb, you 3-bet to 9bb from BB, CO calls. 3-bet pot.",
    },
}


def _derive_scenario_context(position_matchup: str, hero_position: str) -> str:
    return _SCENARIO_CONTEXT.get(position_matchup, {}).get(
        hero_position, f"{position_matchup} ({hero_position})"
    )

_result_cache: dict[str, dict] = {}

SUITS = ["c", "d", "h", "s"]
RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]


# ── Schemas ───────────────────────────────────────────────────────────────────

class SpotOut(BaseModel):
    id: str
    spot_key: str
    label: str
    position_matchup: str
    board_texture: str
    board: str
    solve_status: str
    solved_at: Optional[str]


class GameStateOut(BaseModel):
    session_id: str
    hero_combo: str
    hero_position: str
    board: str
    pot: int
    effective_stack: int
    node_path: list[str]
    node_type: str
    available_actions: list[dict]
    villain_action: Optional[str]       # last villain action (for display)
    is_terminal: bool
    street: str
    scenario_context: Optional[str] = None
    action_history: list[str] = []      # full sequence: all actions + dealt cards
    position_matchup: str = ""          # e.g. "BTN_vs_BB"


class StartSessionIn(BaseModel):
    spot_id: Optional[str] = None
    player_name: str


class ActionIn(BaseModel):
    node_path: list[str]
    chosen_action: str
    pot_at_decision: int


class SessionOut(BaseModel):
    id: str
    spot_key: str
    hero_combo: str
    hero_position: str
    started_at: str
    completed_at: Optional[str]
    gto_score: Optional[float]


class CompleteOut(BaseModel):
    gto_score: float
    decisions: list[dict]


class SpotStatOut(BaseModel):
    spot_key: str
    label: str
    position_matchup: str
    board_texture: str
    hero_position: str
    sessions_count: int
    avg_gto_score: float
    best_score: Optional[float]
    worst_score: Optional[float]
    last_played_at: Optional[str]


class StatsOut(BaseModel):
    total_sessions: int
    avg_gto_score: float
    best_score: Optional[float]
    worst_score: Optional[float]
    last_played_at: Optional[str]
    by_spot: list[SpotStatOut]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_result(spot: TrainerSpot) -> Optional[dict]:
    key = spot.spot_key
    if key in _result_cache:
        return _result_cache[key]
    if not spot.result_path:
        return None
    path = Path(spot.result_path)
    if not path.exists():
        return None
    with open(path) as f:
        data = json.load(f)
    _result_cache[key] = data
    return data


def _parse_range_to_combos(range_str: str, board_cards: set[str]) -> list[str]:
    combos: list[str] = []
    tokens = [t.strip() for t in range_str.split(",") if t.strip()]
    for token in tokens:
        hand = token.split(":")[0].strip()
        if len(hand) == 2:
            r1, r2 = hand[0], hand[1]
            if r1 == r2:
                suits = SUITS[:]
                for i, s1 in enumerate(suits):
                    for s2 in suits[i + 1:]:
                        c1, c2 = r1 + s1, r2 + s2
                        if c1 not in board_cards and c2 not in board_cards:
                            combos.append(c1 + c2)
            else:
                for s1 in SUITS:
                    for s2 in SUITS:
                        if s1 != s2:
                            c1, c2 = r1 + s1, r2 + s2
                            if c1 not in board_cards and c2 not in board_cards:
                                combos.append(c1 + c2)
        elif len(hand) == 3:
            r1, r2, suf = hand[0], hand[1], hand[2]
            if suf == "s":
                for s in SUITS:
                    c1, c2 = r1 + s, r2 + s
                    if c1 not in board_cards and c2 not in board_cards:
                        combos.append(c1 + c2)
            elif suf == "o":
                for s1 in SUITS:
                    for s2 in SUITS:
                        if s1 != s2:
                            c1, c2 = r1 + s1, r2 + s2
                            if c1 not in board_cards and c2 not in board_cards:
                                combos.append(c1 + c2)
    return combos


def _navigate_tree(root: dict, node_path: list[str]) -> Optional[dict]:
    node = root
    for step in node_path:
        children = node.get("childrens") or node.get("deal_cards") or {}
        node = children.get(step)
        if node is None:
            return None
    return node


def _get_action_entries(node: dict) -> list[dict]:
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


def _find_iso_combo(strategy: dict, combo: str) -> Optional[str]:
    r1, s1, r2, s2 = combo[0], combo[1], combo[2], combo[3]
    for perm in set(permutations(SUITS)):
        suit_map = dict(zip(SUITS, perm))
        candidate = r1 + suit_map[s1] + r2 + suit_map[s2]
        if candidate in strategy:
            return candidate
    return None


def _gto_freq_for_combo(node: dict, hero_combo: str, action_name: str) -> float:
    entries = _get_action_entries(node)
    strategy = node.get("strategy", {}).get("strategy", {})
    if not strategy:
        return 1.0 / max(len(entries), 1)
    entry = next((e for e in entries if e["name"] == action_name), None)
    if entry is None:
        return 0.0
    idx = entry["index"]
    freqs = strategy.get(hero_combo)
    if freqs is None:
        freqs_key = _find_iso_combo(strategy, hero_combo)
        freqs = strategy.get(freqs_key) if freqs_key else None
    if freqs is None:
        all_vals = [v[idx] for v in strategy.values() if len(v) > idx]
        return sum(all_vals) / len(all_vals) if all_vals else 0.0
    return freqs[idx] if idx < len(freqs) else 0.0


def _is_villain_node(node: dict, hero_position: str, hero_combo: str) -> bool:
    """Return True if this action_node belongs to the villain (not hero).

    Tries the solver's 'player' field first (0=OOP, 1=IP) for reliability.
    Falls back to a direct combo lookup: if hero's combo is absent from the
    node's strategy, the node belongs to the villain.
    Direct lookup only — no iso fallback, which can produce false positives
    when villain's range contains suit-isomorphic versions of hero's combo.
    """
    player = node.get("player")
    if player is not None:
        # TexasSolver convention: player 0 = OOP, player 1 = IP
        node_is_oop = (player == 0)
        hero_is_oop = (hero_position == "oop")
        return node_is_oop != hero_is_oop
    # Fallback: check strategy keys (direct lookup, no iso)
    strategy = node.get("strategy", {}).get("strategy", {})
    if not strategy:
        return False  # no data → assume hero's node
    return hero_combo not in strategy


def _sample_villain_action(node: dict, villain_combo: Optional[str]) -> str:
    entries = _get_action_entries(node)
    strategy = node.get("strategy", {}).get("strategy", {})
    if not strategy or not entries:
        child_keys = list((node.get("childrens") or {}).keys())
        return random.choice(child_keys) if child_keys else "CHECK"
    if villain_combo:
        freqs = strategy.get(villain_combo) or strategy.get(_find_iso_combo(strategy, villain_combo) or "")
    else:
        freqs = None
    if not freqs:
        all_freqs = list(strategy.values())
        freqs = [sum(v[i] for v in all_freqs) / len(all_freqs) for i in range(len(entries))]
    r = random.random()
    cumulative = 0.0
    for e, f in zip(entries, freqs):
        cumulative += f
        if r <= cumulative:
            return e["name"]
    return entries[-1]["name"]


def _compute_street(node_path: list[str]) -> str:
    """Determine the current street by counting board cards dealt in node_path.
    The initial board is the flop (3 cards in spot.board). Each additional
    card in the path represents turn (+1) or river (+2)."""
    board_cards_in_path = sum(1 for step in node_path if _CARD_PAT.match(step))
    if board_cards_in_path == 0:
        return "flop"
    elif board_cards_in_path == 1:
        return "turn"
    else:
        return "river"


def _available_actions(node: dict, hero_combo: str) -> list[dict]:
    entries = _get_action_entries(node)
    result = []
    for e in entries:
        freq = _gto_freq_for_combo(node, hero_combo, e["name"])
        result.append({"name": e["name"], "gto_freq": round(freq, 4)})
    return result


def _advance_to_hero(
    tree: dict,
    node_path: list[str],
    hero_position: str,
    hero_combo: str,
) -> tuple[Optional[dict], list[str], list[str], Optional[str]]:
    """Auto-advance through chance nodes and villain action nodes until we
    reach a hero action node or a terminal (None).

    Returns:
        (next_node, updated_node_path, new_board_cards, last_villain_action)
    """
    new_board_cards: list[str] = []
    last_villain_action: Optional[str] = None
    next_node = _navigate_tree(tree, node_path)

    while next_node is not None:
        ntype = next_node.get("node_type")

        if ntype == "chance_node":
            deal_cards = next_node.get("deal_cards", {})
            if not deal_cards:
                next_node = None
                break
            runout = random.choice(list(deal_cards.keys()))
            node_path.append(runout)
            new_board_cards.append(runout)
            next_node = deal_cards[runout]

        elif ntype == "action_node":
            if _is_villain_node(next_node, hero_position, hero_combo):
                entries = _get_action_entries(next_node)
                if not entries:
                    # No actions → terminal (shouldn't normally happen)
                    next_node = None
                    break
                villain_action = _sample_villain_action(next_node, None)
                last_villain_action = villain_action
                node_path.append(villain_action)
                next_node = _navigate_tree(tree, node_path)
                # loop continues: may hit another chance node (next street)
                # or another villain node (shouldn't happen normally, but safe)
            else:
                # Hero's action node — stop and return it
                break

        else:
            # Unknown node type → treat as terminal
            next_node = None
            break

    return next_node, node_path, new_board_cards, last_villain_action


_sessions: dict[str, dict] = {}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/spots", response_model=list[SpotOut])
async def list_spots(db: AsyncSession = Depends(get_db)) -> list[SpotOut]:
    result = await db.execute(select(TrainerSpot).order_by(TrainerSpot.position_matchup, TrainerSpot.board_texture))
    spots = result.scalars().all()
    return [SpotOut(
        id=str(s.id), spot_key=s.spot_key, label=s.label,
        position_matchup=s.position_matchup, board_texture=s.board_texture,
        board=s.board, solve_status=s.solve_status,
        solved_at=s.solved_at.isoformat() if s.solved_at else None,
    ) for s in spots]


@router.get("/spots/ready", response_model=list[SpotOut])
async def list_ready_spots(db: AsyncSession = Depends(get_db)) -> list[SpotOut]:
    result = await db.execute(select(TrainerSpot).where(TrainerSpot.solve_status == "ready"))
    spots = result.scalars().all()
    return [SpotOut(
        id=str(s.id), spot_key=s.spot_key, label=s.label,
        position_matchup=s.position_matchup, board_texture=s.board_texture,
        board=s.board, solve_status=s.solve_status,
        solved_at=s.solved_at.isoformat() if s.solved_at else None,
    ) for s in spots]


@router.post("/session/start", response_model=GameStateOut)
async def start_session(
    body: StartSessionIn,
    db: AsyncSession = Depends(get_db),
) -> GameStateOut:
    player_name = body.player_name
    spot_id = body.spot_id

    if spot_id:
        result = await db.execute(
            select(TrainerSpot).where(TrainerSpot.id == uuid.UUID(spot_id), TrainerSpot.solve_status == "ready")
        )
        spot = result.scalar_one_or_none()
        if not spot:
            raise HTTPException(status_code=404, detail="Spot not found or not ready")
    else:
        result = await db.execute(select(TrainerSpot).where(TrainerSpot.solve_status == "ready"))
        ready_spots = result.scalars().all()
        if not ready_spots:
            raise HTTPException(status_code=503, detail="No spots solved yet. Please wait for background solving to complete.")
        spot = random.choice(ready_spots)

    tree = _load_result(spot)
    if not tree:
        raise HTTPException(status_code=503, detail="Spot result not available")

    hero_position = random.choice(["ip", "oop"])
    range_str = spot.range_ip if hero_position == "ip" else spot.range_oop
    board_set: set[str] = set(spot.board.replace(",", " ").split())

    combos = _parse_range_to_combos(range_str, board_set)
    if not combos:
        raise HTTPException(status_code=500, detail="No valid combos after board removal")
    hero_combo = random.choice(combos)

    # Auto-advance from root through any villain nodes / chance nodes
    # until we reach hero's first action node.
    node_path: list[str] = []
    next_node, node_path, new_board_cards, villain_action_at_start = _advance_to_hero(
        tree, node_path, hero_position, hero_combo
    )

    if next_node is None:
        raise HTTPException(status_code=500, detail="Could not navigate to hero's first action node")

    session = TrainingSession(
        player_name=player_name,
        spot_id=spot.id,
        hero_combo=hero_combo,
        hero_position=hero_position,
        decisions_json=[],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    session_id = str(session.id)
    scenario_context = _derive_scenario_context(spot.position_matchup, hero_position)

    # Build action history from the path (villain actions + dealt cards at start)
    action_history: list[str] = []
    for step in node_path:
        if _CARD_PAT.match(step):
            action_history.append(f"[{step}]")   # dealt card
        else:
            action_history.append(f"V:{step}")   # villain action

    _sessions[session_id] = {
        "spot": spot,
        "tree": tree,
        "hero_combo": hero_combo,
        "hero_position": hero_position,
        "player_name": player_name,
        "node_path": node_path,
        "decisions": [],
        "initial_pot": spot.pot,
        "extra_board_cards": list(new_board_cards),
        "scenario_context": scenario_context,
        "action_history": list(action_history),
        "position_matchup": spot.position_matchup,
    }

    actions = _available_actions(next_node, hero_combo)
    is_terminal = len(actions) == 0

    # Build board string including any turn/river cards dealt before first action
    board_str = spot.board
    if new_board_cards:
        board_str += "," + ",".join(new_board_cards)

    return GameStateOut(
        session_id=session_id,
        hero_combo=hero_combo,
        hero_position=hero_position,
        board=board_str,
        pot=spot.pot,
        effective_stack=spot.effective_stack,
        node_path=node_path,
        node_type=next_node.get("node_type", "action_node"),
        available_actions=actions,
        villain_action=villain_action_at_start,
        is_terminal=is_terminal,
        street=_compute_street(node_path),
        scenario_context=scenario_context,
        action_history=action_history,
        position_matchup=spot.position_matchup,
    )


@router.post("/session/{session_id}/action", response_model=GameStateOut)
async def submit_action(
    session_id: str,
    body: ActionIn,
    db: AsyncSession = Depends(get_db),
) -> GameStateOut:
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    spot: TrainerSpot = state["spot"]
    tree: dict = state["tree"]
    hero_combo: str = state["hero_combo"]
    hero_position: str = state["hero_position"]
    node_path = list(state["node_path"])
    scenario_context: Optional[str] = state.get("scenario_context")
    position_matchup: str = state.get("position_matchup", "")

    current_node = _navigate_tree(tree, node_path)
    if not current_node:
        raise HTTPException(status_code=400, detail="Invalid node path")

    # Record this decision with full action context for result screen
    all_actions_at_node = _available_actions(current_node, hero_combo)
    gto_freq = _gto_freq_for_combo(current_node, hero_combo, body.chosen_action)
    state["decisions"].append({
        "node_path": list(node_path),
        "chosen_action": body.chosen_action,
        "gto_freq": gto_freq,
        "all_actions": all_actions_at_node,
        "pot_weight": body.pot_at_decision / max(state["initial_pot"], 1),
        "street": _compute_street(node_path),
    })

    # Update action history with hero's choice
    action_history: list[str] = list(state["action_history"])
    action_history.append(f"H:{body.chosen_action}")

    # Advance past hero's action
    node_path.append(body.chosen_action)

    # Auto-advance through villain actions + chance nodes until hero's next turn
    next_node, node_path, new_board_cards, last_villain_action = _advance_to_hero(
        tree, node_path, hero_position, hero_combo
    )

    # Append dealt cards and villain actions to history
    # We reconstruct from the new steps appended after hero's action
    steps_after_hero = node_path[len(state["node_path"]) + 1:]  # skip hero's action too
    for step in steps_after_hero:
        if _CARD_PAT.match(step):
            action_history.append(f"[{step}]")
        else:
            action_history.append(f"V:{step}")

    # Update session state
    state["node_path"] = node_path
    state["action_history"] = action_history
    state.setdefault("extra_board_cards", []).extend(new_board_cards)

    # Build updated board string
    extra = state.get("extra_board_cards", [])
    board_str = spot.board + ("," + ",".join(extra) if extra else "")

    # Persist decisions to DB
    session_result = await db.execute(
        select(TrainingSession).where(TrainingSession.id == uuid.UUID(session_id))
    )
    session = session_result.scalar_one_or_none()
    if session:
        session.decisions_json = list(state["decisions"])
        await db.commit()

    if next_node is None:
        return GameStateOut(
            session_id=session_id,
            hero_combo=hero_combo,
            hero_position=hero_position,
            board=board_str,
            pot=body.pot_at_decision,
            effective_stack=spot.effective_stack,
            node_path=node_path,
            node_type="terminal",
            available_actions=[],
            villain_action=last_villain_action,
            is_terminal=True,
            street=_compute_street(node_path),
            scenario_context=scenario_context,
            action_history=action_history,
            position_matchup=position_matchup,
        )

    actions = _available_actions(next_node, hero_combo) if next_node.get("node_type") == "action_node" else []
    return GameStateOut(
        session_id=session_id,
        hero_combo=hero_combo,
        hero_position=hero_position,
        board=board_str,
        pot=body.pot_at_decision,
        effective_stack=spot.effective_stack,
        node_path=node_path,
        node_type=next_node.get("node_type", "terminal"),
        available_actions=actions,
        villain_action=last_villain_action,
        is_terminal=len(actions) == 0,
        street=_compute_street(node_path),
        scenario_context=scenario_context,
        action_history=action_history,
        position_matchup=position_matchup,
    )


@router.post("/session/{session_id}/complete", response_model=CompleteOut)
async def complete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> CompleteOut:
    state = _sessions.get(session_id)
    decisions = state["decisions"] if state else []

    # Fetch session + spot together for the upsert
    row_result = await db.execute(
        select(TrainingSession, TrainerSpot)
        .join(TrainerSpot, TrainingSession.spot_id == TrainerSpot.id)
        .where(TrainingSession.id == uuid.UUID(session_id))
    )
    row = row_result.one_or_none()
    session = row.TrainingSession if row else None
    spot_db = row.TrainerSpot if row else None

    # Fallback: use persisted decisions if in-memory state is gone
    if not decisions and session:
        decisions = session.decisions_json or []

    # Simple average of GTO frequency across all decisions (all streets)
    if decisions:
        gto_score = round(sum(d["gto_freq"] for d in decisions) / len(decisions), 4)
    else:
        gto_score = 0.0

    now = datetime.now(timezone.utc)

    if session:
        session.completed_at = now
        session.gto_score = gto_score
        session.decisions_json = decisions
        await db.flush()

    # Upsert per-player per-spot aggregate stats
    if session and spot_db and gto_score > 0:
        stmt = pg_insert(PlayerSpotStat).values(
            player_name=session.player_name,
            spot_key=spot_db.spot_key,
            position_matchup=spot_db.position_matchup,
            board_texture=spot_db.board_texture,
            hero_position=session.hero_position,
            sessions_count=1,
            avg_gto_score=gto_score,
            best_score=gto_score,
            worst_score=gto_score,
            last_played_at=now,
        ).on_conflict_do_update(
            constraint="uq_player_spot_position",
            set_={
                "sessions_count": PlayerSpotStat.sessions_count + 1,
                "avg_gto_score": (
                    PlayerSpotStat.avg_gto_score * PlayerSpotStat.sessions_count + gto_score
                ) / (PlayerSpotStat.sessions_count + 1),
                "best_score": func.greatest(
                    func.coalesce(PlayerSpotStat.best_score, gto_score), gto_score
                ),
                "worst_score": func.least(
                    func.coalesce(PlayerSpotStat.worst_score, gto_score), gto_score
                ),
                "last_played_at": now,
            },
        )
        await db.execute(stmt)

    await db.commit()
    _sessions.pop(session_id, None)
    return CompleteOut(gto_score=gto_score, decisions=decisions)


@router.get("/session/{session_id}/node-strategy")
async def get_node_strategy(
    session_id: str,
    node_path: str = Query(default=""),
) -> dict:
    """Return the strategy dict at a given node path for rendering a range matrix."""
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    tree: dict = state["tree"]
    path = [p for p in node_path.split(",") if p] if node_path else []
    node = _navigate_tree(tree, path)
    if node is None or node.get("node_type") != "action_node":
        raise HTTPException(status_code=404, detail="No action node at path")
    entries = _get_action_entries(node)
    strategy = node.get("strategy", {}).get("strategy", {})
    return {"strategy": strategy, "entries": entries}


@router.get("/stats", response_model=StatsOut)
async def get_stats(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> StatsOut:
    """Aggregate GTO performance stats per player, broken down by spot + position."""
    result = await db.execute(
        select(PlayerSpotStat, TrainerSpot.label)
        .join(TrainerSpot, PlayerSpotStat.spot_key == TrainerSpot.spot_key)
        .where(PlayerSpotStat.player_name == player_name)
        .order_by(PlayerSpotStat.avg_gto_score.asc())
    )
    rows = result.all()

    if not rows:
        return StatsOut(
            total_sessions=0,
            avg_gto_score=0.0,
            best_score=None,
            worst_score=None,
            last_played_at=None,
            by_spot=[],
        )

    by_spot = [
        SpotStatOut(
            spot_key=r.PlayerSpotStat.spot_key,
            label=r.label,
            position_matchup=r.PlayerSpotStat.position_matchup,
            board_texture=r.PlayerSpotStat.board_texture,
            hero_position=r.PlayerSpotStat.hero_position,
            sessions_count=r.PlayerSpotStat.sessions_count,
            avg_gto_score=round(r.PlayerSpotStat.avg_gto_score, 4),
            best_score=r.PlayerSpotStat.best_score,
            worst_score=r.PlayerSpotStat.worst_score,
            last_played_at=(
                r.PlayerSpotStat.last_played_at.isoformat()
                if r.PlayerSpotStat.last_played_at else None
            ),
        )
        for r in rows
    ]

    total_n = sum(r.PlayerSpotStat.sessions_count for r in rows)
    weighted_avg = (
        sum(r.PlayerSpotStat.avg_gto_score * r.PlayerSpotStat.sessions_count for r in rows) / total_n
        if total_n > 0 else 0.0
    )
    best = max(
        (r.PlayerSpotStat.best_score for r in rows if r.PlayerSpotStat.best_score is not None),
        default=None,
    )
    worst = min(
        (r.PlayerSpotStat.worst_score for r in rows if r.PlayerSpotStat.worst_score is not None),
        default=None,
    )
    last_played = max(
        (r.PlayerSpotStat.last_played_at for r in rows if r.PlayerSpotStat.last_played_at is not None),
        default=None,
    )

    return StatsOut(
        total_sessions=total_n,
        avg_gto_score=round(weighted_avg, 4),
        best_score=best,
        worst_score=worst,
        last_played_at=last_played.isoformat() if last_played else None,
        by_spot=by_spot,
    )


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> list[SessionOut]:
    result = await db.execute(
        select(TrainingSession, TrainerSpot.spot_key)
        .join(TrainerSpot, TrainingSession.spot_id == TrainerSpot.id)
        .where(TrainingSession.player_name == player_name)
        .order_by(TrainingSession.started_at.desc())
        .limit(100)
    )
    rows = result.all()
    return [SessionOut(
        id=str(r.TrainingSession.id),
        spot_key=r.spot_key,
        hero_combo=r.TrainingSession.hero_combo,
        hero_position=r.TrainingSession.hero_position,
        started_at=r.TrainingSession.started_at.isoformat(),
        completed_at=r.TrainingSession.completed_at.isoformat() if r.TrainingSession.completed_at else None,
        gto_score=r.TrainingSession.gto_score,
    ) for r in rows]
