"""PokerStars hand history parser.

Supports: Zoom 6-max NL Hold'em, cash games, English format, EUR/USD/GBP.
Skips tournament hands and hands where hero wasn't dealt cards.
"""

import re
from datetime import datetime, timezone
from typing import Optional


# ── Regexes ──────────────────────────────────────────────────────────────────

_RE_HEADER = re.compile(
    r"PokerStars(?:\s+Zoom)?\s+Hand\s+#(\d+):\s+Hold'em No Limit\s+"
    r"\([€$£]?([\d.]+)/[€$£]?([\d.]+)\)\s+-\s+"
    r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.IGNORECASE,
)
_RE_TABLE = re.compile(r"Table '([^']+)' (?:6-max )?Seat #(\d+) is the button")
_RE_SEAT = re.compile(r"Seat (\d+): ([^\s(]+)(?:\s+\([€$£]?([\d.]+) in chips\))?")
_RE_HOLE = re.compile(r"Dealt to ([^\s]+) \[([2-9TJQKA][cdhs])\s+([2-9TJQKA][cdhs])\]")
_RE_FLOP = re.compile(r"\*\*\* FLOP \*\*\* \[([2-9TJQKA][cdhs])\s+([2-9TJQKA][cdhs])\s+([2-9TJQKA][cdhs])\]")
_RE_TURN = re.compile(r"\*\*\* TURN \*\*\* \[[^\]]+\] \[([2-9TJQKA][cdhs])\]")
_RE_RIVER = re.compile(r"\*\*\* RIVER \*\*\* \[[^\]]+\] \[([2-9TJQKA][cdhs])\]")
_RE_ACTION = re.compile(
    r"^([^\s:]+): (folds|checks|calls|bets|raises|is all-in)"
    r"(?:\s+[€$£]?([\d.]+))?(?:\s+to\s+[€$£]?([\d.]+))?",
    re.MULTILINE,
)
_RE_POT = re.compile(r"Total pot [€$£]?([\d.]+).*?Rake [€$£]?([\d.]+)")
_RE_COLLECT = re.compile(r"^([^\s]+) collected [€$£]?([\d.]+) from (?:main )?pot", re.MULTILINE)
_RE_TOURNAMENT = re.compile(r"Tournament", re.IGNORECASE)

_STREET_MARKERS = {
    "preflop": re.compile(r"\*\*\* HOLE CARDS \*\*\*"),
    "flop":    re.compile(r"\*\*\* FLOP \*\*\*"),
    "turn":    re.compile(r"\*\*\* TURN \*\*\*"),
    "river":   re.compile(r"\*\*\* RIVER \*\*\*"),
    "summary": re.compile(r"\*\*\* SUMMARY \*\*\*"),
}

# 6-max position order: seats relative to button (0=BTN, 1=SB, 2=BB, 3=EP, 4=HJ, 5=CO for 6-max)
_POSITIONS_6MAX = ["BTN", "SB", "BB", "EP", "HJ", "CO"]


def _to_cents(amount_str: str) -> int:
    return round(float(amount_str) * 100)


def _derive_position(seat_num: int, btn_seat: int, total_seats: int) -> str:
    """Map seat number to position label given button seat."""
    # Relative position from button (0=BTN, 1=SB, 2=BB, ...)
    rel = (seat_num - btn_seat) % total_seats
    labels = _POSITIONS_6MAX[:total_seats]
    return labels[rel] if rel < len(labels) else f"S{seat_num}"


def _split_streets(hand_text: str) -> dict[str, str]:
    """Split hand text into named street sections."""
    positions: dict[str, int] = {}
    for name, pat in _STREET_MARKERS.items():
        m = pat.search(hand_text)
        if m:
            positions[name] = m.start()

    ordered = sorted(positions.items(), key=lambda x: x[1])
    sections: dict[str, str] = {}
    for i, (name, start) in enumerate(ordered):
        end = ordered[i + 1][1] if i + 1 < len(ordered) else len(hand_text)
        sections[name] = hand_text[start:end]
    return sections


def _parse_actions(section_text: str, hero: str) -> list[dict]:
    """Extract action records from a street section."""
    actions = []
    for m in _RE_ACTION.finditer(section_text):
        player, verb, amount_str, to_str = m.group(1), m.group(2), m.group(3), m.group(4)
        amount = _to_cents(to_str or amount_str) if (to_str or amount_str) else 0
        actions.append({
            "player": player,
            "is_hero": player == hero,
            "action": verb,
            "amount": amount,
        })
    return actions


def parse_hand(hand_text: str, hero_username: Optional[str]) -> Optional[dict]:
    """Parse a single hand block. Returns a dict or None if the hand should be skipped."""
    # Skip tournaments
    if _RE_TOURNAMENT.search(hand_text[:200]):
        return None

    # Header
    hm = _RE_HEADER.search(hand_text)
    if not hm:
        return None
    hand_id_raw = hm.group(1)
    sb_cents = _to_cents(hm.group(2))
    bb_cents = _to_cents(hm.group(3))
    dt_str = hm.group(4)
    played_at = datetime.strptime(dt_str, "%Y/%m/%d %H:%M:%S").replace(tzinfo=timezone.utc)

    # Table
    tm = _RE_TABLE.search(hand_text)
    table_name = tm.group(1) if tm else "Unknown"
    btn_seat = int(tm.group(2)) if tm else 1

    # Seats
    seats: dict[int, str] = {}
    for sm in _RE_SEAT.finditer(hand_text):
        seat_num = int(sm.group(1))
        player = sm.group(2)
        seats[seat_num] = player

    total_seats = len(seats)
    if total_seats == 0:
        return None

    # Hero identification
    hero = hero_username
    if not hero:
        return None  # No hero means we can't filter

    # Hole cards
    hc_m = _RE_HOLE.search(hand_text)
    hero_hole_cards: Optional[str] = None
    if hc_m and hc_m.group(1) == hero:
        hero_hole_cards = hc_m.group(2) + hc_m.group(3)

    # Hero seat and position
    hero_seat: Optional[int] = None
    for seat_num, player in seats.items():
        if player == hero:
            hero_seat = seat_num
            break
    hero_position = _derive_position(hero_seat, btn_seat, total_seats) if hero_seat else None

    # Board
    board_cards: list[str] = []
    fm = _RE_FLOP.search(hand_text)
    if fm:
        board_cards.extend([fm.group(1), fm.group(2), fm.group(3)])
    turn_m = _RE_TURN.search(hand_text)
    if turn_m:
        board_cards.append(turn_m.group(1))
    river_m = _RE_RIVER.search(hand_text)
    if river_m:
        board_cards.append(river_m.group(1))
    board = "".join(board_cards) or None

    # Street sections and actions
    sections = _split_streets(hand_text)
    actions_json: dict[str, list] = {}
    for street in ("preflop", "flop", "turn", "river"):
        if street in sections:
            actions_json[street] = _parse_actions(sections[street], hero)

    # VPIP / PFR / 3-bet
    preflop_actions = actions_json.get("preflop", [])
    raise_count = 0
    vpip = False
    pfr = False
    three_bet_opportunity = False
    three_bet = False

    for act in preflop_actions:
        if act["action"] in ("raises", "bets"):
            if raise_count >= 1:
                three_bet_opportunity = True
            raise_count += 1
            if act["is_hero"]:
                vpip = True
                pfr = True
                if raise_count >= 2:
                    three_bet = True
        elif act["action"] == "calls" and act["is_hero"]:
            vpip = True
        # Set 3-bet opportunity flag if villain raised before hero had a chance
        if not act["is_hero"] and act["action"] in ("raises", "bets") and raise_count >= 1:
            three_bet_opportunity = True

    # Pot and rake
    summary_text = sections.get("summary", hand_text[-500:])
    pot_m = _RE_POT.search(summary_text)
    pot_total = _to_cents(pot_m.group(1)) if pot_m else 0
    rake = _to_cents(pot_m.group(2)) if pot_m else 0

    # Hero result
    hero_result = 0
    hero_won = False
    went_to_showdown = "SHOW DOWN" in hand_text

    # Amount hero invested
    invested = 0
    for street_acts in actions_json.values():
        for act in street_acts:
            if act["is_hero"] and act["action"] in ("calls", "bets", "raises"):
                invested += act["amount"]
    # Blind posting
    if hero_position == "SB":
        invested += sb_cents
    elif hero_position == "BB":
        invested += bb_cents

    # Amount hero collected
    collected = 0
    for cm in _RE_COLLECT.finditer(summary_text):
        if cm.group(1) == hero:
            collected += _to_cents(cm.group(2))
            hero_won = True

    hero_result = collected - invested

    return {
        "hand_id_raw": hand_id_raw,
        "played_at": played_at,
        "stakes_sb": sb_cents,
        "stakes_bb": bb_cents,
        "table_name": table_name,
        "hero_seat": hero_seat,
        "hero_position": hero_position,
        "hero_hole_cards": hero_hole_cards,
        "board": board,
        "pot_total": pot_total,
        "rake": rake,
        "hero_result": hero_result,
        "hero_won": hero_won,
        "went_to_showdown": went_to_showdown,
        "vpip": vpip,
        "pfr": pfr,
        "three_bet_opportunity": three_bet_opportunity,
        "three_bet": three_bet,
        "actions_json": actions_json,
        "raw_text": hand_text,
    }


def parse_file(content: str, hero_username: Optional[str]) -> list[dict]:
    """Parse an entire hand history file. Returns list of parsed hand dicts."""
    # Split on blank lines between hands (PokerStars uses double+ newlines)
    blocks = re.split(r"\n{2,}", content.strip())
    # Regroup: each hand starts with "PokerStars"
    hands_raw: list[str] = []
    current: list[str] = []
    for block in blocks:
        if _RE_HEADER.search(block[:300]):
            if current:
                hands_raw.append("\n\n".join(current))
            current = [block]
        else:
            current.append(block)
    if current:
        hands_raw.append("\n\n".join(current))

    results = []
    for raw in hands_raw:
        parsed = parse_hand(raw.strip(), hero_username)
        if parsed:
            results.append(parsed)
    return results
