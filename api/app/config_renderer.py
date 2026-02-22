"""Renders a TexasSolver console config file from a SolveRequest."""

from models import SolveRequest


def render_config(request: SolveRequest, output_path: str) -> str:
    """
    Returns the content of a solver config .txt file.

    output_path: absolute path where the solver should write its JSON result.
    """
    lines: list[str] = []

    lines.append(f"set_pot {request.pot}")
    lines.append(f"set_effective_stack {request.effective_stack}")
    lines.append(f"set_board {request.board}")
    lines.append(f"set_range_ip {request.range_ip}")
    lines.append(f"set_range_oop {request.range_oop}")

    for bs in request.bet_sizes:
        if bs.action == "allin" or not bs.sizes:
            lines.append(f"set_bet_sizes {bs.position},{bs.street},{bs.action}")
        else:
            sizes_str = ",".join(str(s) for s in bs.sizes)
            lines.append(f"set_bet_sizes {bs.position},{bs.street},{bs.action},{sizes_str}")

    lines.append(f"set_allin_threshold {request.allin_threshold}")
    lines.append("build_tree")
    lines.append(f"set_thread_num {request.thread_num}")
    lines.append(f"set_accuracy {request.accuracy}")
    lines.append(f"set_max_iteration {request.max_iteration}")
    lines.append(f"set_print_interval {request.print_interval}")
    lines.append(f"set_use_isomorphism {1 if request.use_isomorphism else 0}")
    lines.append("start_solve")
    lines.append(f"set_dump_rounds {request.dump_rounds}")
    lines.append(f"dump_result {output_path}")

    return "\n".join(lines) + "\n"
