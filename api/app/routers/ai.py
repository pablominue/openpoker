"""AI Agent router — chat, RAG retrieval, document management."""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator, Optional

import aiofiles
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from db.base import AsyncSessionLocal
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.deps import get_db
from db.models import AIConversation, AIDocument, AIMessage, Hand, PlayerRange, TrainerSpot

logger = logging.getLogger("AI")

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ---------------------------------------------------------------------------
# Settings (from environment)
# ---------------------------------------------------------------------------
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:14b")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:5001")
AI_DOCS_DIR = Path(os.getenv("AI_DOCS_DIR", "/app/ai_docs"))

POKER_EXPERT_SYSTEM_PROMPT = """You are an expert poker coach and GTO (Game Theory Optimal) analyst specialised in No-Limit Texas Hold'em. You have deep knowledge of:
- Preflop ranges: opens, 3-bets, 4-bets, calls by position
- Postflop play: c-betting, check-raising, bluffing frequencies, board texture analysis
- GTO solver outputs: reading strategy frequencies, EV calculations, mixed strategies
- Hand reading and range construction
- Positional play and stack-to-pot ratio considerations
- Player statistics: VPIP, PFR, 3-bet%, WTSD, AF, C-bet%

You have access to tools that query the player's actual hand database. Use them proactively:
- When asked about leaks, call query_position_stats and query_street_aggression
- When asked about specific spots, call query_hand_sample to find real examples
- When asked about showdown tendencies, call query_showdown_stats
- Use position BTN/CO as a proxy for In Position (IP); SB/BB as Out of Position (OOP)

When analysing hands or ranges:
1. Be specific and cite the data from tool results
2. Explain the GTO reasoning, not just what to do
3. Identify leaks and exploits where relevant
4. Use poker terminology correctly
5. If tool results are empty, say so clearly — do not hallucinate stats

Respond in clear, concise language. Format with bullet points or numbered steps when listing multiple actions."""

# ---------------------------------------------------------------------------
# Poker analytics tools (for Ollama function calling)
# ---------------------------------------------------------------------------

POKER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_position_stats",
            "description": (
                "Get win rate, VPIP, PFR, 3-bet%, and WTSD broken down by position. "
                "Call this to analyse how the player performs from each seat at the table."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "positions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Positions to include (UTG, HJ, CO, BTN, SB, BB). Empty = all positions.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_street_aggression",
            "description": (
                "Get hero's bet/raise/check/call/fold frequencies on a specific street, "
                "optionally filtered by position. Use BTN/CO for IP analysis, SB/BB for OOP."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "street": {
                        "type": "string",
                        "enum": ["flop", "turn", "river"],
                        "description": "Street to analyse",
                    },
                    "positions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by position(s). BTN/CO ≈ IP; SB/BB ≈ OOP.",
                    },
                },
                "required": ["street"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_hand_sample",
            "description": (
                "Get a sample of actual hands with full hand history text for deep analysis. "
                "Use when you need concrete examples to illustrate a leak or pattern."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "position": {
                        "type": "string",
                        "description": "Filter by hero position (UTG/HJ/CO/BTN/SB/BB)",
                    },
                    "street_reached": {
                        "type": "string",
                        "enum": ["flop", "turn", "river"],
                        "description": "Minimum street the hand reached",
                    },
                    "result_bb_max": {
                        "type": "number",
                        "description": "Max result in bb — use negative values to find losing hands (e.g. -5)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of hands to return (default 6, max 12)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_showdown_stats",
            "description": "Get went-to-showdown (WTSD) and won-at-showdown (W$SD) rates by position.",
            "parameters": {
                "type": "object",
                "properties": {
                    "positions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by position(s). Empty = all.",
                    }
                },
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool execution functions
# ---------------------------------------------------------------------------

async def _tool_position_stats(player_name: str, positions: list[str], db: AsyncSession) -> str:
    from sqlalchemy import func as sqlfunc, case
    q = (
        select(
            Hand.hero_position,
            sqlfunc.count(Hand.id).label("hands"),
            sqlfunc.avg(case((Hand.vpip == True, 1), else_=0)).label("vpip"),
            sqlfunc.avg(case((Hand.pfr == True, 1), else_=0)).label("pfr"),
            sqlfunc.avg(case((Hand.three_bet == True, 1), else_=0)).label("three_bet"),
            sqlfunc.avg(case((Hand.went_to_showdown == True, 1), else_=0)).label("wtsd"),
            sqlfunc.sum(Hand.hero_result).label("total_result"),
            sqlfunc.avg(Hand.stakes_bb).label("avg_bb"),
        )
        .where(Hand.player_name == player_name, Hand.hero_position.isnot(None))
        .group_by(Hand.hero_position)
        .order_by(Hand.hero_position)
    )
    if positions:
        q = q.where(Hand.hero_position.in_(positions))
    rows = (await db.execute(q)).fetchall()
    if not rows:
        return "No position data found."
    lines = ["## Position Breakdown"]
    for r in rows:
        win_rate = (r.total_result or 0) / max(r.avg_bb or 1, 1) / max(r.hands, 1) * 100
        lines.append(
            f"- **{r.hero_position}**: {r.hands} hands | "
            f"VPIP {(r.vpip or 0)*100:.0f}% | PFR {(r.pfr or 0)*100:.0f}% | "
            f"3bet {(r.three_bet or 0)*100:.0f}% | WTSD {(r.wtsd or 0)*100:.0f}% | "
            f"Win {win_rate:.1f}bb/100"
        )
    return "\n".join(lines)


async def _tool_street_aggression(player_name: str, street: str, positions: list[str], db: AsyncSession) -> str:
    q = select(Hand).where(Hand.player_name == player_name, Hand.actions_json.isnot(None))
    if positions:
        q = q.where(Hand.hero_position.in_(positions))
    hands = (await db.execute(q.limit(2000))).scalars().all()
    hands = [h for h in hands if (h.actions_json or {}).get(street)]
    if not hands:
        pos_label = f" from {', '.join(positions)}" if positions else ""
        return f"No hands reaching the {street}{pos_label} found."

    bets = raises = checks = calls = folds = 0
    bet_sizes_bb: list[float] = []
    for h in hands:
        for act in (h.actions_json or {}).get(street, []):
            if not act.get("is_hero"):
                continue
            verb = act.get("action", "")
            amount = act.get("amount") or 0
            if verb == "bets":
                bets += 1
                if h.stakes_bb and amount:
                    bet_sizes_bb.append(amount / h.stakes_bb)
            elif verb == "raises":
                raises += 1
            elif verb == "checks":
                checks += 1
            elif verb == "calls":
                calls += 1
            elif verb == "folds":
                folds += 1

    total = len(hands)
    pos_label = f" ({', '.join(positions)})" if positions else ""
    lines = [
        f"## {street.capitalize()} Aggression{pos_label} — {total} hands",
        f"- Bet: {bets} ({bets/total*100:.0f}%)",
        f"- Raise: {raises} ({raises/total*100:.0f}%)",
        f"- Check: {checks} ({checks/total*100:.0f}%)",
        f"- Call: {calls} ({calls/total*100:.0f}%)",
        f"- Fold: {folds} ({folds/total*100:.0f}%)",
    ]
    if bet_sizes_bb:
        lines.append(f"- Avg bet size: {sum(bet_sizes_bb)/len(bet_sizes_bb):.1f}bb")
    return "\n".join(lines)


async def _tool_hand_sample(
    player_name: str,
    position: str | None,
    street_reached: str | None,
    result_bb_max: float | None,
    limit: int,
    db: AsyncSession,
) -> str:
    from sqlalchemy import literal
    limit = min(max(limit or 6, 1), 12)
    q = select(Hand).where(Hand.player_name == player_name)
    if position:
        q = q.where(Hand.hero_position == position)
    if street_reached:
        q = q.where(Hand.actions_json.isnot(None))
    if result_bb_max is not None:
        q = q.where(Hand.hero_result <= literal(int(result_bb_max * 100)) * Hand.stakes_bb / 100)
    q = q.order_by(desc(Hand.played_at)).limit(limit * 3)  # over-fetch, filter in Python
    hands = (await db.execute(q)).scalars().all()
    if street_reached:
        hands = [h for h in hands if (h.actions_json or {}).get(street_reached)]
    hands = hands[:limit]
    if not hands:
        return "No matching hands found."
    lines = [f"## Hand Sample ({len(hands)} hands)"]
    for h in hands:
        result_bb = h.hero_result / max(h.stakes_bb, 1) / 100
        lines.append(
            f"\n**{h.hand_id_raw}** | {h.played_at.strftime('%Y-%m-%d')} | "
            f"Pos: {h.hero_position} | Cards: {h.hero_hole_cards or '??'} | "
            f"Board: {h.board or '-'} | Result: {result_bb:+.1f}bb"
        )
        if h.raw_text:
            lines.append(f"```\n{h.raw_text[:500]}{'...' if len(h.raw_text) > 500 else ''}\n```")
    return "\n".join(lines)


async def _tool_showdown_stats(player_name: str, positions: list[str], db: AsyncSession) -> str:
    from sqlalchemy import func as sqlfunc, case
    q = (
        select(
            Hand.hero_position,
            sqlfunc.count(Hand.id).label("hands"),
            sqlfunc.avg(case((Hand.went_to_showdown == True, 1), else_=0)).label("wtsd"),
            sqlfunc.avg(
                case((Hand.went_to_showdown == True, case((Hand.hero_won == True, 1), else_=0)), else_=None)
            ).label("wsd"),
            sqlfunc.avg(case((Hand.hero_won == True, 1), else_=0)).label("overall_wr"),
        )
        .where(Hand.player_name == player_name, Hand.hero_position.isnot(None))
        .group_by(Hand.hero_position)
        .order_by(Hand.hero_position)
    )
    if positions:
        q = q.where(Hand.hero_position.in_(positions))
    rows = (await db.execute(q)).fetchall()
    if not rows:
        return "No showdown data found."
    lines = ["## Showdown Stats by Position"]
    for r in rows:
        lines.append(
            f"- **{r.hero_position}**: {r.hands} hands | "
            f"WTSD {(r.wtsd or 0)*100:.0f}% | "
            f"W$SD {(r.wsd or 0)*100:.0f}% | "
            f"Win% {(r.overall_wr or 0)*100:.0f}%"
        )
    return "\n".join(lines)


async def _execute_tool(name: str, args: dict | str, player_name: str, db: AsyncSession) -> str:
    """Dispatch a tool call to the appropriate SQL function."""
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    try:
        if name == "query_position_stats":
            return await _tool_position_stats(player_name, args.get("positions") or [], db)
        if name == "query_street_aggression":
            return await _tool_street_aggression(
                player_name, args.get("street", "flop"), args.get("positions") or [], db
            )
        if name == "query_hand_sample":
            return await _tool_hand_sample(
                player_name, args.get("position"), args.get("street_reached"),
                args.get("result_bb_max"), args.get("limit", 6), db,
            )
        if name == "query_showdown_stats":
            return await _tool_showdown_stats(player_name, args.get("positions") or [], db)
        return f"Unknown tool: {name}"
    except Exception as exc:
        logger.error("Tool %s failed: %s", name, exc)
        return f"Tool error ({name}): {exc}"


# ---------------------------------------------------------------------------
# Non-streaming Ollama call (for agentic tool loop)
# ---------------------------------------------------------------------------

async def _call_ollama_once(messages: list[dict], system_prompt: str, tools: list | None = None) -> dict:
    """Single non-streaming call to Ollama. Returns the response message dict."""
    payload: dict = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "system": system_prompt,
        "stream": False,
        "options": {"num_ctx": 8192, "temperature": 0.3},
    }
    if tools:
        payload["tools"] = tools
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
            resp.raise_for_status()
            return resp.json().get("message", {})
    except Exception as exc:
        logger.error("Ollama non-streaming call failed: %s", exc)
        return {"role": "assistant", "content": f"Error: {exc}"}


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class HandFilter(BaseModel):
    position: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    limit: int = 20


class ContextConfig(BaseModel):
    include_stats: bool = False
    include_ranges: bool = False
    hand_ids: list[str] = []
    hand_filter: Optional[HandFilter] = None
    gto_spot_keys: list[str] = []
    document_ids: list[str] = []


class ChatMessageRequest(BaseModel):
    content: str
    context: ContextConfig = ContextConfig()


class ConversationCreate(BaseModel):
    player_name: str
    title: str = "New conversation"


class ConversationOut(BaseModel):
    id: str
    player_name: str
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    created_at: str

    class Config:
        from_attributes = True


class ConversationWithMessages(BaseModel):
    id: str
    player_name: str
    title: str
    created_at: str
    updated_at: str
    messages: list[MessageOut]

    class Config:
        from_attributes = True


class DocumentOut(BaseModel):
    id: str
    player_name: str
    filename: str
    content_type: str
    chunk_count: int
    created_at: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Context assembly helpers
# ---------------------------------------------------------------------------

async def _build_stats_context(player_name: str, db: AsyncSession) -> str:
    """Fetch aggregate player stats from the Hand table."""
    from sqlalchemy import func as sqlfunc, case
    result = await db.execute(
        select(
            sqlfunc.count(Hand.id).label("total_hands"),
            sqlfunc.avg(case((Hand.vpip == True, 1), else_=0)).label("vpip"),
            sqlfunc.avg(case((Hand.pfr == True, 1), else_=0)).label("pfr"),
            sqlfunc.avg(case((Hand.three_bet == True, 1), else_=0)).label("three_bet"),
            sqlfunc.avg(case((Hand.went_to_showdown == True, 1), else_=0)).label("wtsd"),
            sqlfunc.sum(Hand.hero_result).label("total_result"),
            sqlfunc.avg(Hand.stakes_bb).label("avg_bb"),
        ).where(Hand.player_name == player_name)
    )
    row = result.one()
    if not row.total_hands:
        return f"No hand history found for player '{player_name}'."

    win_rate = (row.total_result or 0) / max(row.avg_bb or 1, 1) / max(row.total_hands, 1) * 100
    lines = [
        f"## Player Stats for {player_name}",
        f"- Total hands: {row.total_hands}",
        f"- VPIP: {(row.vpip or 0)*100:.1f}%",
        f"- PFR: {(row.pfr or 0)*100:.1f}%",
        f"- 3-bet%: {(row.three_bet or 0)*100:.1f}%",
        f"- WTSD: {(row.wtsd or 0)*100:.1f}%",
        f"- Win rate: {win_rate:.2f} bb/100",
    ]

    # Per-position breakdown
    pos_result = await db.execute(
        select(
            Hand.hero_position,
            sqlfunc.count(Hand.id).label("hands"),
            sqlfunc.avg(case((Hand.vpip == True, 1), else_=0)).label("vpip"),
            sqlfunc.avg(case((Hand.pfr == True, 1), else_=0)).label("pfr"),
        ).where(Hand.player_name == player_name, Hand.hero_position.isnot(None))
        .group_by(Hand.hero_position)
        .order_by(Hand.hero_position)
    )
    rows = pos_result.fetchall()
    if rows:
        lines.append("\n### By Position")
        for r in rows:
            lines.append(f"- {r.hero_position}: {r.hands} hands, VPIP {(r.vpip or 0)*100:.0f}%, PFR {(r.pfr or 0)*100:.0f}%")

    return "\n".join(lines)


async def _build_ranges_context(player_name: str, db: AsyncSession) -> str:
    """Fetch player's saved preflop ranges."""
    result = await db.execute(
        select(PlayerRange)
        .where(PlayerRange.player_name == player_name)
        .order_by(PlayerRange.scenario_key)
    )
    ranges = result.scalars().all()
    if not ranges:
        return f"No saved preflop ranges for player '{player_name}'."

    lines = [f"## Preflop Ranges for {player_name}"]
    for r in ranges:
        if r.range_str:
            lines.append(f"- {r.scenario_label} ({r.scenario_key}): {r.range_str[:120]}{'...' if len(r.range_str) > 120 else ''}")
    return "\n".join(lines)


async def _build_hands_context(
    player_name: str,
    hand_ids: list[str],
    hand_filter: Optional[HandFilter],
    db: AsyncSession,
) -> str:
    """Fetch selected or filtered hands and format as context."""
    query = select(Hand).where(Hand.player_name == player_name)

    if hand_ids:
        parsed_ids = []
        for hid in hand_ids:
            try:
                parsed_ids.append(uuid.UUID(hid))
            except ValueError:
                pass
        query = query.where(Hand.id.in_(parsed_ids))
    elif hand_filter:
        if hand_filter.position:
            query = query.where(Hand.hero_position == hand_filter.position)
        if hand_filter.date_from:
            query = query.where(Hand.played_at >= hand_filter.date_from)
        if hand_filter.date_to:
            query = query.where(Hand.played_at <= hand_filter.date_to)
        query = query.order_by(desc(Hand.played_at)).limit(hand_filter.limit)
    else:
        return ""

    result = await db.execute(query)
    hands = result.scalars().all()
    if not hands:
        return "No matching hands found."

    lines = [f"## Hand History ({len(hands)} hands)"]
    for h in hands:
        result_bb = h.hero_result / max(h.stakes_bb, 1) / 100
        actions_summary = ""
        if h.actions_json:
            streets = list(h.actions_json.keys()) if isinstance(h.actions_json, dict) else []
            actions_summary = f" | Streets: {', '.join(streets)}"
        lines.append(
            f"- Hand {h.hand_id_raw} | {h.played_at.strftime('%Y-%m-%d')} | "
            f"Pos: {h.hero_position or '?'} | Cards: {h.hero_hole_cards or '??'} | "
            f"Board: {h.board or '-'} | Result: {result_bb:+.1f}bb{actions_summary}"
        )
        if h.raw_text and len(lines) <= 10:
            # Include full raw text for first 10 hands if available
            lines.append(f"```\n{h.raw_text[:600]}{'...' if len(h.raw_text) > 600 else ''}\n```")
    return "\n".join(lines)


async def _build_gto_context(spot_keys: list[str]) -> str:
    """Load GTO spot results from solved JSON files."""
    LIBRARY_DIR = Path("/app/jobs/library")
    lines = ["## GTO Solver Reference Spots"]
    for key in spot_keys[:4]:  # cap at 4 spots to control context size
        result_path = LIBRARY_DIR / key / "result.json"
        if not result_path.exists():
            lines.append(f"- Spot '{key}': not yet solved or not found.")
            continue
        try:
            data = json.loads(result_path.read_text())
            # Extract high-level info from the solver result
            root = data if isinstance(data, dict) else {}
            node_type = root.get("node_type", "unknown")
            board = root.get("board", key)
            lines.append(f"- Spot '{key}' | Board: {board} | Node type: {node_type}")
            # Summarise root actions if present
            if "actions" in root and "strategy" in root:
                actions = root["actions"]
                strategy = root["strategy"]
                if isinstance(strategy, list) and isinstance(actions, list):
                    action_strs = [f"{a}={v:.1%}" for a, v in zip(actions, strategy[:len(actions)])]
                    lines.append(f"  Root strategy: {', '.join(action_strs[:6])}")
        except Exception as exc:
            lines.append(f"- Spot '{key}': error reading result ({exc})")
    return "\n".join(lines)


async def _retrieve_documents(query: str, doc_ids: list[str]) -> str:
    """Query the RAG service for relevant document chunks."""
    if not doc_ids:
        return ""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{AI_SERVICE_URL}/retrieve",
                json={"query": query, "doc_ids": doc_ids, "top_k": 6},
            )
            resp.raise_for_status()
            results = resp.json()
    except Exception as exc:
        logger.warning("RAG retrieve failed: %s", exc)
        return ""

    if not results:
        return ""

    lines = ["## Relevant Document Excerpts"]
    for r in results:
        lines.append(f"**[{r['filename']}]** (relevance: {r['score']:.2f})\n{r['text']}\n")
    return "\n".join(lines)


async def _assemble_context(
    player_name: str,
    config: ContextConfig,
    message: str,
    db: AsyncSession,
) -> tuple[str, dict]:
    """Assemble all requested context sections. Returns (context_text, context_snapshot)."""
    parts: list[str] = []
    snapshot: dict = {}

    if config.include_stats:
        stats = await _build_stats_context(player_name, db)
        parts.append(stats)
        snapshot["stats"] = True

    if config.include_ranges:
        ranges = await _build_ranges_context(player_name, db)
        parts.append(ranges)
        snapshot["ranges"] = True

    if config.hand_ids or config.hand_filter:
        hands = await _build_hands_context(player_name, config.hand_ids, config.hand_filter, db)
        parts.append(hands)
        snapshot["hand_ids"] = config.hand_ids
        snapshot["hand_filter"] = config.hand_filter.model_dump() if config.hand_filter else None

    if config.gto_spot_keys:
        gto = await _build_gto_context(config.gto_spot_keys)
        parts.append(gto)
        snapshot["gto_spot_keys"] = config.gto_spot_keys

    if config.document_ids:
        docs = await _retrieve_documents(message, config.document_ids)
        if docs:
            parts.append(docs)
        snapshot["document_ids"] = config.document_ids

    return "\n\n---\n\n".join(parts), snapshot


# ---------------------------------------------------------------------------
# Ollama streaming
# ---------------------------------------------------------------------------

async def _stream_ollama(
    messages: list[dict],
    system_prompt: str,
) -> AsyncGenerator[str, None]:
    """Stream chat completion from Ollama, yielding SSE data lines."""
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "system": system_prompt,
        "stream": True,
        "options": {
            "num_ctx": 8192,
            "temperature": 0.3,
        },
    }
    url = f"{OLLAMA_BASE_URL}/api/chat"
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    error_msg = f"Ollama error {resp.status_code}: {body.decode()[:200]}"
                    logger.error(error_msg)
                    yield f"data: {json.dumps({'error': error_msg})}\n\n"
                    return
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
                        if data.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue
    except httpx.ConnectError:
        yield f"data: {json.dumps({'error': 'Cannot connect to Ollama. Is it running on the host?'})}\n\n"
    except Exception as exc:
        logger.error("Ollama stream error: %s", exc)
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"


# ---------------------------------------------------------------------------
# Conversation endpoints
# ---------------------------------------------------------------------------

@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(body: ConversationCreate, db: AsyncSession = Depends(get_db)):
    conv = AIConversation(player_name=body.player_name, title=body.title)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return _conv_out(conv, 0)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.player_name == player_name)
        .order_by(desc(AIConversation.updated_at))
        .limit(50)
    )
    convs = result.scalars().all()
    # Get message counts
    from sqlalchemy import func as sqlfunc
    counts_result = await db.execute(
        select(AIMessage.conversation_id, sqlfunc.count(AIMessage.id).label("cnt"))
        .where(AIMessage.conversation_id.in_([c.id for c in convs]))
        .group_by(AIMessage.conversation_id)
    )
    counts = {str(r.conversation_id): r.cnt for r in counts_result}
    return [_conv_out(c, counts.get(str(c.id), 0)) for c in convs]


@router.get("/conversations/{conversation_id}", response_model=ConversationWithMessages)
async def get_conversation(conversation_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AIConversation)
        .options(selectinload(AIConversation.messages))
        .where(AIConversation.id == uuid.UUID(conversation_id))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _conv_with_messages_out(conv)


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AIConversation).where(AIConversation.id == uuid.UUID(conversation_id))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conv)
    await db.commit()


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: ChatMessageRequest,
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Stream a chat response using SSE. Saves both user and assistant messages when done."""
    # Verify conversation exists
    result = await db.execute(
        select(AIConversation)
        .options(selectinload(AIConversation.messages))
        .where(AIConversation.id == uuid.UUID(conversation_id))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Build context
    context_text, context_snapshot = await _assemble_context(
        player_name, body.context, body.content, db
    )

    # Build system prompt
    system_prompt = POKER_EXPERT_SYSTEM_PROMPT + f"\n\nYou are coaching player: {player_name}."
    if context_text:
        system_prompt += f"\n\n# Context Data for {player_name}\n\n{context_text}"
    else:
        system_prompt += (
            "\n\nNo player-specific context has been provided for this message. "
            "If the player asks about their specific stats, hands, or leaks, remind them "
            "to open the Context panel (bottom-left of the sidebar) and enable the relevant "
            "sources (Stats, Hand History, etc.) before sending their question."
        )

    # Build message history for Ollama
    history = [{"role": m.role, "content": m.content} for m in conv.messages[-20:]]
    history.append({"role": "user", "content": body.content})

    # Save the conversation title from first user message
    is_first = len(conv.messages) == 0
    title_update = body.content[:80] if is_first else None

    # Agentic tool loop: let the LLM call SQL tools before streaming the answer
    tool_messages: list[dict] = []
    for _iteration in range(4):
        msg = await _call_ollama_once(history + tool_messages, system_prompt, POKER_TOOLS)
        tool_calls = msg.get("tool_calls", [])
        if not tool_calls:
            break  # No more tools needed; proceed to streaming
        tool_messages.append(msg)
        for tc in tool_calls:
            fn = tc.get("function", {})
            result = await _execute_tool(fn.get("name", ""), fn.get("arguments", {}), player_name, db)
            logger.info("Tool %s → %d chars", fn.get("name"), len(result))
            tool_messages.append({"role": "tool", "content": result})

    # Final messages = history + any tool call/result pairs
    final_messages = history + tool_messages

    # Accumulate the full response for DB persistence
    full_response_parts: list[str] = []

    async def generate():
        nonlocal full_response_parts
        # Emit a status line if tools were called so the user knows what happened
        if tool_messages:
            n_calls = sum(1 for m in tool_messages if m.get("tool_calls"))
            plural = "s" if n_calls != 1 else ""
            status = f"*[Queried your hand database ({n_calls} tool call{plural})]*\n\n"
            yield f"data: {json.dumps({'chunk': status})}\n\n"
        async for sse_line in _stream_ollama(final_messages, system_prompt):
            # Parse chunk for accumulation
            if sse_line.startswith("data: "):
                try:
                    data = json.loads(sse_line[6:])
                    if "chunk" in data:
                        full_response_parts.append(data["chunk"])
                except Exception:
                    pass
            yield sse_line

        # After streaming completes, persist messages
        full_response = "".join(full_response_parts)
        async with AsyncSessionLocal() as save_db:
            # Reload conversation to avoid stale session
            conv_res = await save_db.execute(
                select(AIConversation).where(AIConversation.id == uuid.UUID(conversation_id))
            )
            save_conv = conv_res.scalar_one_or_none()
            if save_conv:
                if title_update:
                    save_conv.title = title_update
                save_conv.updated_at = datetime.now(timezone.utc)

                save_db.add(AIMessage(
                    conversation_id=save_conv.id,
                    role="user",
                    content=body.content,
                    context_used=context_snapshot if context_snapshot else None,
                ))
                if full_response:
                    save_db.add(AIMessage(
                        conversation_id=save_conv.id,
                        role="assistant",
                        content=full_response,
                    ))
                await save_db.commit()

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Document endpoints
# ---------------------------------------------------------------------------

@router.post("/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    player_name: str = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()
    content_type = "pdf" if ext == ".pdf" else "text"
    doc_id = str(uuid.uuid4())

    # Save to disk
    player_docs_dir = AI_DOCS_DIR / player_name
    player_docs_dir.mkdir(parents=True, exist_ok=True)
    file_path = player_docs_dir / f"{doc_id}_{filename}"

    async with aiofiles.open(str(file_path), "wb") as f:
        while chunk := await file.read(65536):
            await f.write(chunk)

    # Create DB record
    doc = AIDocument(
        id=uuid.UUID(doc_id),
        player_name=player_name,
        filename=filename,
        content_type=content_type,
        file_path=str(file_path),
        chunk_count=0,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Trigger indexing in the RAG service (non-blocking — fire and forget)
    import asyncio
    asyncio.create_task(_index_document_in_rag(doc))

    return _doc_out(doc)


async def _index_document_in_rag(doc: AIDocument) -> None:
    """Send index request to the RAG service and update chunk_count in DB."""
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{AI_SERVICE_URL}/index",
                json={
                    "doc_id": str(doc.id),
                    "filename": doc.filename,
                    "file_path": doc.file_path,
                    "content_type": doc.content_type,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            chunk_count = data.get("chunks", 0)

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AIDocument).where(AIDocument.id == doc.id)
            )
            d = result.scalar_one_or_none()
            if d:
                d.chunk_count = chunk_count
                await db.commit()
        logger.info("Indexed document %s: %d chunks", doc.filename, chunk_count)
    except Exception as exc:
        logger.error("Failed to index document %s: %s", doc.filename, exc)


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    player_name: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AIDocument)
        .where(AIDocument.player_name == player_name)
        .order_by(desc(AIDocument.created_at))
    )
    return [_doc_out(d) for d in result.scalars().all()]


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AIDocument).where(AIDocument.id == uuid.UUID(document_id))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove file
    try:
        Path(doc.file_path).unlink(missing_ok=True)
    except Exception:
        pass

    # Tell RAG service to remove from index
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(f"{AI_SERVICE_URL}/remove", json={"doc_id": str(doc.id)})
    except Exception as exc:
        logger.warning("RAG remove failed: %s", exc)

    await db.delete(doc)
    await db.commit()


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _conv_out(conv: AIConversation, message_count: int) -> ConversationOut:
    return ConversationOut(
        id=str(conv.id),
        player_name=conv.player_name,
        title=conv.title,
        created_at=conv.created_at.isoformat() if conv.created_at else "",
        updated_at=conv.updated_at.isoformat() if conv.updated_at else "",
        message_count=message_count,
    )


def _conv_with_messages_out(conv: AIConversation) -> ConversationWithMessages:
    return ConversationWithMessages(
        id=str(conv.id),
        player_name=conv.player_name,
        title=conv.title,
        created_at=conv.created_at.isoformat() if conv.created_at else "",
        updated_at=conv.updated_at.isoformat() if conv.updated_at else "",
        messages=[
            MessageOut(
                id=str(m.id),
                role=m.role,
                content=m.content,
                created_at=m.created_at.isoformat() if m.created_at else "",
            )
            for m in conv.messages
        ],
    )


def _doc_out(doc: AIDocument) -> DocumentOut:
    return DocumentOut(
        id=str(doc.id),
        player_name=doc.player_name,
        filename=doc.filename,
        content_type=doc.content_type,
        chunk_count=doc.chunk_count,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
    )
