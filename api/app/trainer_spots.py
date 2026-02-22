"""Pre-defined trainer spot library.

Each spot represents a post-flop situation that gets solved once and cached.
Ranges are approximate GTO preflop solutions for 6-max NL100.

Pot/stack units: chips (1 chip = 1 BB unit here for simplicity).
Single-raised pot (SRP): pot=7 (raise 2.5bb + call), stack=93 (100bb effective - 7bb invested).
  Scaled to solver integers (×10): pot=70, stack=930.
3-bet pot: pot=20 (typical 3-bet), stack=80.
  Scaled ×10: pot=200, stack=800.
"""

# GTO preflop ranges (abbreviated — representative for training)
_BTN_OPEN = (
    "AA,KK,QQ,JJ,TT,99:0.5,88:0.33,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
    "KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,98s,87s,76s,65s,54s,"
    "AKo,AQo,AJo:0.75,ATo:0.5,KQo,KJo:0.5"
)
_BB_DEFEND_VS_BTN = (
    "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
    "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
    "KQs,KJs,KTs,K9s,K8s,QJs,QTs,Q9s,JTs,J9s,J8s,T9s,T8s,98s,97s,87s,86s,76s,75s,65s,64s,54s,53s,"
    "AKo,AQo,AJo,ATo,A9o:0.5,KQo,KJo,KTo:0.5,QJo,QTo:0.5,JTo:0.5"
)
_CO_OPEN = (
    "AA,KK,QQ,JJ,TT,99,88:0.5,AKs,AQs,AJs,ATs,A9s,A8s,A5s,A4s,A3s,A2s,"
    "KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,"
    "AKo,AQo,AJo,KQo,KJo:0.5"
)
_BB_DEFEND_VS_CO = (
    "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
    "AKs,AQs,AJs,ATs,A9s,A8s,A5s,A4s,A3s,A2s,"
    "KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,"
    "AKo,AQo,AJo,ATo:0.5,KQo,KJo,QJo:0.5"
)
_SB_OPEN = (
    "AA,KK,QQ,JJ,TT,99,88,77,66:0.5,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
    "KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,98s,87s,76s,65s,54s,"
    "AKo,AQo,AJo,ATo,KQo,KJo,QJo:0.5"
)
_BB_DEFEND_VS_SB = (
    "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
    "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A5s,A4s,A3s,A2s,"
    "KQs,KJs,KTs,K9s,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,"
    "AKo,AQo,AJo,ATo,A9o:0.5,KQo,KJo,KTo:0.5,QJo,JTo:0.5"
)
_HJ_OPEN = (
    "AA,KK,QQ,JJ,TT,99,88:0.5,AKs,AQs,AJs,ATs,A9s,A5s,A4s,"
    "KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,"
    "AKo,AQo,KQo"
)
_BB_DEFEND_VS_HJ = (
    "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
    "AKs,AQs,AJs,ATs,A9s,A5s,A4s,A3s,"
    "KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,"
    "AKo,AQo,AJo:0.5,KQo,KJo:0.5"
)
# 3-bet pot ranges (simplified)
_BTN_CALL_3BET = "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AJs,KQs:0.5,AKo,AQo:0.5"
_SB_3BET = "AA,KK,QQ,JJ,TT:0.5,AKs,AKo,AQs:0.5"
_BB_3BET_VS_CO = "AA,KK,QQ,JJ:0.5,AKs,AKo,AQs:0.5,KQs:0.5"
_CO_CALL_3BET_VS_BB = "AA,KK,QQ,JJ,TT:0.5,AKs,AQs,AKo:0.5"

# Simplified bet sizes — one size per action to keep tree small enough for Docker
_STD_BET_SIZES = [
    {"position": "ip",  "street": "flop",  "action": "bet",   "sizes": [50]},
    {"position": "ip",  "street": "flop",  "action": "raise", "sizes": [100]},
    {"position": "ip",  "street": "turn",  "action": "bet",   "sizes": [75]},
    {"position": "ip",  "street": "turn",  "action": "raise", "sizes": [100]},
    {"position": "ip",  "street": "river", "action": "bet",   "sizes": [75]},
    {"position": "ip",  "street": "river", "action": "raise", "sizes": [100]},
    {"position": "oop", "street": "flop",  "action": "bet",   "sizes": [50]},
    {"position": "oop", "street": "flop",  "action": "raise", "sizes": [100]},
    {"position": "oop", "street": "turn",  "action": "bet",   "sizes": [75]},
    {"position": "oop", "street": "turn",  "action": "raise", "sizes": [100]},
    {"position": "oop", "street": "river", "action": "bet",   "sizes": [75]},
    {"position": "oop", "street": "river", "action": "raise", "sizes": [100]},
]

# Scaled pot/stack for SRP and 3-bet pots (solver works in integer chips)
_SRP_POT = 70        # 7bb × 10 scaling
_SRP_STACK = 930     # 93bb remaining
_THREE_BET_POT = 200
_THREE_BET_STACK = 800

_SOLVE_PARAMS = {
    "accuracy": 1.0,
    "max_iteration": 150,
    "print_interval": 10,
    "thread_num": 2,
    "use_isomorphism": True,
    "dump_rounds": 2,   # flop + turn (river OOMs solver in Docker; nav loop handles graceful exit)
    "allin_threshold": 0.67,
}

TRAINER_SPOTS: list[dict] = [
    # ── BTN vs BB ──────────────────────────────────────────────────────────────
    {
        "key": "BTN_BB_dry_low",
        "label": "BTN vs BB · Dry Low (259r)",
        "position_matchup": "BTN_vs_BB",
        "board_texture": "dry_low",
        "board": "2c,5h,9d",
        "range_ip": _BTN_OPEN,
        "range_oop": _BB_DEFEND_VS_BTN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "BTN_BB_wet_high",
        "label": "BTN vs BB · Wet High (TJ9hh)",
        "position_matchup": "BTN_vs_BB",
        "board_texture": "wet_high",
        "board": "Tc,Jh,9h",
        "range_ip": _BTN_OPEN,
        "range_oop": _BB_DEFEND_VS_BTN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "BTN_BB_monotone",
        "label": "BTN vs BB · Monotone (725c)",
        "position_matchup": "BTN_vs_BB",
        "board_texture": "monotone",
        "board": "7c,2c,5c",
        "range_ip": _BTN_OPEN,
        "range_oop": _BB_DEFEND_VS_BTN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "BTN_BB_paired_high",
        "label": "BTN vs BB · Paired High (KK7r)",
        "position_matchup": "BTN_vs_BB",
        "board_texture": "paired_high",
        "board": "Kh,Kd,7c",
        "range_ip": _BTN_OPEN,
        "range_oop": _BB_DEFEND_VS_BTN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    # ── CO vs BB ───────────────────────────────────────────────────────────────
    {
        "key": "CO_BB_dry_low",
        "label": "CO vs BB · Dry Low (37Jr)",
        "position_matchup": "CO_vs_BB",
        "board_texture": "dry_low",
        "board": "3d,7h,Jc",
        "range_ip": _CO_OPEN,
        "range_oop": _BB_DEFEND_VS_CO,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "CO_BB_wet_high",
        "label": "CO vs BB · Wet High (89Thh)",
        "position_matchup": "CO_vs_BB",
        "board_texture": "wet_high",
        "board": "8h,9c,Th",
        "range_ip": _CO_OPEN,
        "range_oop": _BB_DEFEND_VS_CO,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "CO_BB_monotone",
        "label": "CO vs BB · Monotone (A63s)",
        "position_matchup": "CO_vs_BB",
        "board_texture": "monotone",
        "board": "As,6s,3s",
        "range_ip": _CO_OPEN,
        "range_oop": _BB_DEFEND_VS_CO,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "CO_BB_paired_mid",
        "label": "CO vs BB · Paired Mid (88Kr)",
        "position_matchup": "CO_vs_BB",
        "board_texture": "paired_mid",
        "board": "8c,8d,Kh",
        "range_ip": _CO_OPEN,
        "range_oop": _BB_DEFEND_VS_CO,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    # ── SB vs BB ───────────────────────────────────────────────────────────────
    {
        "key": "SB_BB_dry_low",
        "label": "SB vs BB · Dry Low (472r)",
        "position_matchup": "SB_vs_BB",
        "board_texture": "dry_low",
        "board": "4c,7d,2h",
        "range_ip": _BB_DEFEND_VS_SB,   # BB is IP postflop
        "range_oop": _SB_OPEN,           # SB is OOP postflop
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "SB_BB_wet_high",
        "label": "SB vs BB · Wet High (QJ9ss)",
        "position_matchup": "SB_vs_BB",
        "board_texture": "wet_high",
        "board": "Qs,Js,9d",
        "range_ip": _BB_DEFEND_VS_SB,
        "range_oop": _SB_OPEN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "SB_BB_monotone",
        "label": "SB vs BB · Monotone (K62h)",
        "position_matchup": "SB_vs_BB",
        "board_texture": "monotone",
        "board": "Kh,6h,2h",
        "range_ip": _BB_DEFEND_VS_SB,
        "range_oop": _SB_OPEN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "SB_BB_paired_low",
        "label": "SB vs BB · Paired Low (55Ar)",
        "position_matchup": "SB_vs_BB",
        "board_texture": "paired_low",
        "board": "5c,5h,Ac",
        "range_ip": _BB_DEFEND_VS_SB,
        "range_oop": _SB_OPEN,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    # ── HJ vs BB ───────────────────────────────────────────────────────────────
    {
        "key": "HJ_BB_dry_low",
        "label": "HJ vs BB · Dry Low (269r)",
        "position_matchup": "HJ_vs_BB",
        "board_texture": "dry_low",
        "board": "2s,6c,9h",
        "range_ip": _HJ_OPEN,
        "range_oop": _BB_DEFEND_VS_HJ,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "HJ_BB_wet_high",
        "label": "HJ vs BB · Wet High (9TJcd)",
        "position_matchup": "HJ_vs_BB",
        "board_texture": "wet_high",
        "board": "9d,Td,Jc",
        "range_ip": _HJ_OPEN,
        "range_oop": _BB_DEFEND_VS_HJ,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "HJ_BB_paired_high",
        "label": "HJ vs BB · Paired High (AA5r)",
        "position_matchup": "HJ_vs_BB",
        "board_texture": "paired_high",
        "board": "Ah,Ad,5c",
        "range_ip": _HJ_OPEN,
        "range_oop": _BB_DEFEND_VS_HJ,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "HJ_BB_monotone",
        "label": "HJ vs BB · Monotone (38Qh)",
        "position_matchup": "HJ_vs_BB",
        "board_texture": "monotone",
        "board": "3h,8h,Qh",
        "range_ip": _HJ_OPEN,
        "range_oop": _BB_DEFEND_VS_HJ,
        "pot": _SRP_POT,
        "effective_stack": _SRP_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    # ── BTN vs SB 3-bet pot ───────────────────────────────────────────────────
    {
        "key": "BTN_SB_3bet_dry",
        "label": "BTN vs SB 3bet · Dry (27Kr)",
        "position_matchup": "BTN_vs_SB_3bet",
        "board_texture": "dry",
        "board": "2d,7c,Kh",
        "range_ip": _BTN_CALL_3BET,
        "range_oop": _SB_3BET,
        "pot": _THREE_BET_POT,
        "effective_stack": _THREE_BET_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "BTN_SB_3bet_wet",
        "label": "BTN vs SB 3bet · Wet (AT8hh)",
        "position_matchup": "BTN_vs_SB_3bet",
        "board_texture": "wet",
        "board": "Ah,Th,8c",
        "range_ip": _BTN_CALL_3BET,
        "range_oop": _SB_3BET,
        "pot": _THREE_BET_POT,
        "effective_stack": _THREE_BET_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    # ── CO vs BB 3-bet pot ────────────────────────────────────────────────────
    {
        "key": "CO_BB_3bet_dry",
        "label": "CO vs BB 3bet · Dry (492r)",
        "position_matchup": "CO_vs_BB_3bet",
        "board_texture": "dry",
        "board": "4h,9c,2d",
        "range_ip": _CO_CALL_3BET_VS_BB,
        "range_oop": _BB_3BET_VS_CO,
        "pot": _THREE_BET_POT,
        "effective_stack": _THREE_BET_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
    {
        "key": "CO_BB_3bet_wet",
        "label": "CO vs BB 3bet · Wet (JT7cc)",
        "position_matchup": "CO_vs_BB_3bet",
        "board_texture": "wet",
        "board": "Jc,Tc,7h",
        "range_ip": _CO_CALL_3BET_VS_BB,
        "range_oop": _BB_3BET_VS_CO,
        "pot": _THREE_BET_POT,
        "effective_stack": _THREE_BET_STACK,
        "bet_sizes": _STD_BET_SIZES,
        **_SOLVE_PARAMS,
    },
]


# Bump this when solve params change (e.g. dump_rounds) to force re-solving all spots.
# Stored in TrainerSpot.job_id as a version tag for trainer library spots.
_SOLVE_VERSION = "v3-2streets"


async def seed_spots(db) -> None:
    """Upsert all trainer spots into the database.
    New spots are inserted as pending. Existing spots that failed or whose
    solve version tag changed are reset to pending so they get re-solved."""
    from sqlalchemy import select
    from db.models import TrainerSpot

    for spot in TRAINER_SPOTS:
        result = await db.execute(
            select(TrainerSpot).where(TrainerSpot.spot_key == spot["key"])
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            ts = TrainerSpot(
                spot_key=spot["key"],
                label=spot["label"],
                position_matchup=spot["position_matchup"],
                board_texture=spot["board_texture"],
                board=spot["board"],
                range_ip=spot["range_ip"],
                range_oop=spot["range_oop"],
                pot=spot["pot"],
                effective_stack=spot["effective_stack"],
                bet_sizes_json=spot["bet_sizes"],
                solve_status="pending",
                job_id=_SOLVE_VERSION,   # tag so we can detect version changes
            )
            db.add(ts)
        else:
            needs_resolve = (
                existing.solve_status == "failed"
                or existing.job_id != _SOLVE_VERSION  # params changed
            )
            if needs_resolve:
                existing.bet_sizes_json = spot["bet_sizes"]
                existing.solve_status = "pending"
                existing.result_path = None
                existing.solved_at = None
                existing.job_id = _SOLVE_VERSION
    await db.commit()
