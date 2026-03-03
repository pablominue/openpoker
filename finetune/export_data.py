#!/usr/bin/env python3
"""
Export hand history + GTO training session data from PostgreSQL to JSONL.

Produces instruction-response pairs suitable for fine-tuning.
Each record has:
  - instruction: hand history text + question about the decision
  - input: (optional context like board/position/stack)
  - output: GTO analysis (score, correct action, explanation if available)

Usage:
    python export_data.py --db-url postgresql://solver:solverpass@localhost:5432/solverdb \
                          --player MyPlayer \
                          --output ./data/export.jsonl \
                          --min-score 0.0

Run this script standalone (outside Docker) against the exposed PostgreSQL port.
"""

import argparse
import json
import os
import sys
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Install psycopg2-binary: pip install psycopg2-binary")
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    tqdm = lambda x, **kw: x  # noqa: E731


SYSTEM_PROMPT = (
    "You are an expert poker coach analysing No-Limit Texas Hold'em hands. "
    "Given a hand history, identify the key decision point, evaluate the action taken "
    "relative to GTO strategy, and provide concise coaching feedback."
)


def format_hand_instruction(raw_text: str, position: str, hole_cards: str, board: str) -> str:
    parts = [f"Position: {position or 'Unknown'}", f"Hole cards: {hole_cards or '??'}"]
    if board:
        parts.append(f"Board: {board}")
    parts.append("")
    parts.append("Hand history:")
    parts.append(raw_text[:1500] if raw_text else "(no raw text)")
    return "\n".join(parts)


def gto_score_to_grade(score: float) -> str:
    if score >= 0.9:
        return "Best Move"
    if score >= 0.75:
        return "Correct (GTO)"
    if score >= 0.4:
        return "Inaccuracy"
    if score >= 0.1:
        return "Mistake"
    return "Blunder"


def export_training_sessions(conn, player_name: str, min_score: float) -> list[dict]:
    """Export completed training sessions with GTO scores."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            ts.id,
            ts.hero_combo,
            ts.hero_position,
            ts.gto_score,
            ts.decisions_json,
            sp.label,
            sp.board,
            sp.position_matchup,
            sp.board_texture
        FROM training_sessions ts
        JOIN trainer_spots sp ON sp.id = ts.spot_id
        WHERE ts.player_name = %s
          AND ts.gto_score IS NOT NULL
          AND ts.gto_score >= %s
          AND ts.completed_at IS NOT NULL
        ORDER BY ts.started_at DESC
    """, (player_name, min_score))
    rows = cur.fetchall()
    records = []
    for row in rows:
        decisions = row["decisions_json"] or []
        for decision in decisions:
            if not isinstance(decision, dict):
                continue
            action = decision.get("action", "?")
            ev = decision.get("ev", None)
            best_ev = decision.get("best_ev", None)
            instruction = (
                f"GTO Training Spot: {row['label']}\n"
                f"Position matchup: {row['position_matchup']}\n"
                f"Board: {row['board']} ({row['board_texture']})\n"
                f"Hero position: {row['hero_position']}\n"
                f"Hero hand: {row['hero_combo']}\n"
                f"Action taken: {action}\n"
                f"Spot GTO score: {row['gto_score']:.0%}"
            )
            output_parts = [f"Grade: {gto_score_to_grade(row['gto_score'])}"]
            if ev is not None:
                output_parts.append(f"EV of action: {ev:.2f}bb")
            if best_ev is not None:
                output_parts.append(f"Best EV available: {best_ev:.2f}bb")
            output_parts.append(
                f"The action '{action}' scored {row['gto_score']:.0%} vs GTO. "
                f"{'This is a strong GTO play.' if row['gto_score'] >= 0.75 else 'Consider the GTO frequencies more carefully.'}"
            )
            records.append({
                "system": SYSTEM_PROMPT,
                "instruction": instruction,
                "input": "",
                "output": "\n".join(output_parts),
                "metadata": {
                    "source": "trainer_session",
                    "spot_key": row.get("label", ""),
                    "player": player_name,
                    "gto_score": row["gto_score"],
                },
            })
    return records


def export_hands(conn, player_name: str) -> list[dict]:
    """Export raw hand histories as analysis requests (unsupervised — no expert output)."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            id::text,
            hero_position,
            hero_hole_cards,
            board,
            raw_text,
            hero_result,
            stakes_bb,
            vpip,
            pfr,
            three_bet,
            went_to_showdown,
            played_at
        FROM hands
        WHERE player_name = %s
          AND raw_text IS NOT NULL
          AND hero_hole_cards IS NOT NULL
        ORDER BY played_at DESC
        LIMIT 10000
    """, (player_name,))
    rows = cur.fetchall()
    records = []
    for row in rows:
        result_bb = row["hero_result"] / max(row["stakes_bb"] or 1, 1) / 100
        instruction = format_hand_instruction(
            row["raw_text"], row["hero_position"],
            row["hero_hole_cards"], row["board"]
        )
        # For unsupervised data, the output is a structured analysis template.
        # In a supervised dataset, this would be replaced with expert annotations.
        flags = []
        if row["vpip"]: flags.append("VPIP")
        if row["pfr"]: flags.append("PFR")
        if row["three_bet"]: flags.append("3-bet")
        if row["went_to_showdown"]: flags.append("WTSD")
        output = (
            f"Hand analysis for {row['hero_position'] or '?'} with {row['hero_hole_cards'] or '??'}"
            f" on {row['board'] or 'preflop'}.\n"
            f"Result: {result_bb:+.1f}bb. Flags: {', '.join(flags) or 'none'}.\n"
            f"[Expert annotation needed — this record requires human review for supervised fine-tuning.]"
        )
        records.append({
            "system": SYSTEM_PROMPT,
            "instruction": instruction,
            "input": "",
            "output": output,
            "metadata": {
                "source": "hand_history",
                "hand_id": row["id"],
                "player": player_name,
                "result_bb": round(result_bb, 2),
                "supervised": False,
            },
        })
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Export poker data to JSONL for fine-tuning")
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL", "postgresql://solver:solverpass@localhost:5432/solverdb"))
    parser.add_argument("--player", required=True, help="Player name to export")
    parser.add_argument("--output", default="data/export.jsonl", help="Output JSONL file path")
    parser.add_argument("--min-score", type=float, default=0.0, help="Minimum GTO score for trainer records")
    parser.add_argument("--supervised-only", action="store_true", help="Only include supervised trainer records (skip raw hands)")
    args = parser.parse_args()

    # Use asyncpg-style URL or psycopg2 style
    db_url = args.db_url.replace("postgresql+asyncpg://", "postgresql://")

    print(f"Connecting to database...")
    try:
        conn = psycopg2.connect(db_url)
    except Exception as e:
        print(f"Connection failed: {e}")
        sys.exit(1)

    records = []

    print("Exporting GTO trainer sessions...")
    sessions = export_training_sessions(conn, args.player, args.min_score)
    records.extend(sessions)
    print(f"  → {len(sessions)} session records")

    if not args.supervised_only:
        print("Exporting hand histories (unsupervised)...")
        hands = export_hands(conn, args.player)
        records.extend(hands)
        print(f"  → {len(hands)} hand records")

    conn.close()

    # Write output
    output_path = args.output
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for record in tqdm(records, desc="Writing JSONL"):
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\nExported {len(records)} records to {output_path}")
    print(f"  Supervised (trainer sessions): {len(sessions)}")
    print(f"  Unsupervised (hands, need annotation): {len(records) - len(sessions)}")
    print("\nNext steps: run prepare_dataset.py to format for llama.cpp / MLX fine-tuning.")


if __name__ == "__main__":
    main()
