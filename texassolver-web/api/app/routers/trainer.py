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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.deps import get_db
from db.models import TrainerSpot, TrainingSession

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
    villain_action: Optional[str]
    is_terminal: bool
    street: str
    scenario_context: Optional[str] = None


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


def _node_street(node_path: list[str]) -> str:
    return "flop"


def _available_actions(node: dict, hero_combo: str) -> list[dict]:
    entries = _get_action_entries(node)
    result = []
    for e in entries:
        freq = _gto_freq_for_combo(node, hero_combo, e["name"])
        result.append({"name": e["name"], "gto_freq": round(freq, 4)})
    return result


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

    node_path: list[str] = []
    root_node = _navigate_tree(tree, node_path)
    if not root_node:
        raise HTTPException(status_code=500, detail="Could not navigate to root node")

    # If the root action node belongs to the villain (hero's combo not in strategy),
    # auto-play the villain's action before returning the initial state.
    villain_action_at_start: Optional[str] = None
    if root_node.get("node_type") == "action_node":
        strategy = root_node.get("strategy", {}).get("strategy", {})
        hero_freqs = strategy.get(hero_combo)
        if hero_freqs is None:
            iso_key = _find_iso_combo(strategy, hero_combo)
            hero_freqs = strategy.get(iso_key or "")
        if hero_freqs is None:
            # Villain acts first — sample and advance
            villain_action_at_start = _sample_villain_action(root_node, None)
            node_path.append(villain_action_at_start)
            root_node = _navigate_tree(tree, node_path)
            if root_node is None:
                raise HTTPException(status_code=500, detail="Tree navigation failed after villain action")

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
    _sessions[session_id] = {
        "spot": spot,
        "tree": tree,
        "hero_combo": hero_combo,
        "hero_position": hero_position,
        "player_name": player_name,
        "node_path": node_path,
        "decisions": [],
        "initial_pot": spot.pot,
        "extra_board_cards": [],
        "scenario_context": scenario_context,
    }

    actions = _available_actions(root_node, hero_combo) if root_node.get("node_type") == "action_node" else []
    is_terminal = root_node.get("node_type") == "action_node" and len(actions) == 0

    return GameStateOut(
        session_id=session_id,
        hero_combo=hero_combo,
        hero_position=hero_position,
        board=spot.board,
        pot=spot.pot,
        effective_stack=spot.effective_stack,
        node_path=node_path,
        node_type=root_node.get("node_type", "action_node"),
        available_actions=actions,
        villain_action=villain_action_at_start,
        is_terminal=is_terminal,
        street="flop",
        scenario_context=scenario_context,
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
    node_path = list(state["node_path"])
    scenario_context: Optional[str] = state.get("scenario_context")

    current_node = _navigate_tree(tree, node_path)
    if not current_node:
        raise HTTPException(status_code=400, detail="Invalid node path")

    gto_freq = _gto_freq_for_combo(current_node, hero_combo, body.chosen_action)
    state["decisions"].append({
        "node_path": list(node_path),
        "chosen_action": body.chosen_action,
        "gto_freq": gto_freq,
        "pot_weight": body.pot_at_decision / max(state["initial_pot"], 1),
        "street": _node_street(node_path),
    })

    node_path.append(body.chosen_action)
    next_node = _navigate_tree(tree, node_path)

    if not next_node:
        state["node_path"] = node_path
        return GameStateOut(
            session_id=session_id,
            hero_combo=hero_combo,
            hero_position=state["hero_position"],
            board=spot.board,
            pot=body.pot_at_decision,
            effective_stack=spot.effective_stack,
            node_path=node_path,
            node_type="terminal",
            available_actions=[],
            villain_action=None,
            is_terminal=True,
            street=_node_street(node_path),
            scenario_context=scenario_context,
        )

    villain_action = None
    # Explicitly track cards dealt via chance nodes (key = card string from solver)
    new_board_cards: list[str] = []

    while next_node and next_node.get("node_type") == "chance_node":
        deal_cards = next_node.get("deal_cards", {})
        if not deal_cards:
            break
        runout = random.choice(list(deal_cards.keys()))
        node_path.append(runout)
        new_board_cards.append(runout)
        next_node = deal_cards[runout]

    if next_node and next_node.get("node_type") == "action_node":
        entries = _get_action_entries(next_node)
        hero_freqs = next_node.get("strategy", {}).get("strategy", {}).get(hero_combo)
        if hero_freqs is None:
            iso_key = _find_iso_combo(next_node.get("strategy", {}).get("strategy", {}), hero_combo)
            hero_freqs = next_node.get("strategy", {}).get("strategy", {}).get(iso_key or "")

        if hero_freqs is None and entries:
            villain_action = _sample_villain_action(next_node, None)
            node_path.append(villain_action)
            next_node = _navigate_tree(tree, node_path)

            while next_node and next_node.get("node_type") == "chance_node":
                deal_cards = next_node.get("deal_cards", {})
                if not deal_cards:
                    break
                runout = random.choice(list(deal_cards.keys()))
                node_path.append(runout)
                new_board_cards.append(runout)
                next_node = deal_cards.get(runout)

    state.setdefault("extra_board_cards", []).extend(new_board_cards)

    # Build the updated board string
    extra = state.get("extra_board_cards", [])
    board_str = spot.board + ("," + ",".join(extra) if extra else "")

    state["node_path"] = node_path

    session_result = await db.execute(
        select(TrainingSession).where(TrainingSession.id == uuid.UUID(session_id))
    )
    session = session_result.scalar_one_or_none()
    if session:
        session.decisions_json = list(state["decisions"])
        await db.commit()

    if not next_node:
        return GameStateOut(
            session_id=session_id,
            hero_combo=hero_combo,
            hero_position=state["hero_position"],
            board=board_str,
            pot=body.pot_at_decision,
            effective_stack=spot.effective_stack,
            node_path=node_path,
            node_type="terminal",
            available_actions=[],
            villain_action=villain_action,
            is_terminal=True,
            street=_node_street(node_path),
            scenario_context=scenario_context,
        )

    actions = _available_actions(next_node, hero_combo) if next_node.get("node_type") == "action_node" else []
    return GameStateOut(
        session_id=session_id,
        hero_combo=hero_combo,
        hero_position=state["hero_position"],
        board=board_str,
        pot=body.pot_at_decision,
        effective_stack=spot.effective_stack,
        node_path=node_path,
        node_type=next_node.get("node_type", "terminal"),
        available_actions=actions,
        villain_action=villain_action,
        is_terminal=len(actions) == 0,
        street=_node_street(node_path),
        scenario_context=scenario_context,
    )


@router.post("/session/{session_id}/complete", response_model=CompleteOut)
async def complete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> CompleteOut:
    state = _sessions.get(session_id)
    decisions = state["decisions"] if state else []

    if decisions:
        total_weight = sum(d["pot_weight"] for d in decisions)
        if total_weight > 0:
            gto_score = round(sum(d["gto_freq"] * d["pot_weight"] for d in decisions) / total_weight, 4)
        else:
            gto_score = round(sum(d["gto_freq"] for d in decisions) / len(decisions), 4)
    else:
        gto_score = 0.0

    result = await db.execute(
        select(TrainingSession).where(TrainingSession.id == uuid.UUID(session_id))
    )
    session = result.scalar_one_or_none()
    if session:
        session.completed_at = datetime.now(timezone.utc)
        session.gto_score = gto_score
        session.decisions_json = decisions
        await db.commit()

    _sessions.pop(session_id, None)
    return CompleteOut(gto_score=gto_score, decisions=decisions)


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
