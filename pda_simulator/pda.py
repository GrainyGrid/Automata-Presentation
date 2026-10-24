"""
Pushdown Automaton (PDA) engine for PAGASA Tropical Cyclone Wind Signals.
Strictly implements transitions T01 through T20 using Breadth-First Search (BFS).
"""

from collections import deque
from dataclasses import dataclass
import re
from typing import Dict, List, Optional, Tuple

MAX_READINGS = 200
MAX_CONFIGS = 100_000

STATE_MEANINGS: Dict[str, str] = {
    "q0": "idle/finished",
    "q1": "transition hub",
    "q2": "no signal",
    "q3": "Signal 1",
    "q4": "Signal 2",
    "q5": "Signal 3",
    "q6": "Signal 4",
    "q7": "Signal 5",
}

SIGNAL_BADGES: Dict[str, str] = {
    "q0": "Idle / Finished (No active system)",
    "q1": "Transition Hub",
    "q2": "No Signal (0–38 km/h)",
    "q3": "Signal 1 (39–61 km/h)",
    "q4": "Signal 2 (62–88 km/h)",
    "q5": "Signal 3 (89–117 km/h)",
    "q6": "Signal 4 (118–184 km/h)",
    "q7": "Signal 5 (≥185 km/h)",
}


@dataclass(frozen=True)
class Transition:
    id: str
    from_state: str
    to_state: str
    band: str  # "ε", "0-38", "39-61", "62-88", "89-117", "118-184", ">=185"
    pop: str   # "ε" or symbol
    push: str  # "ε" or symbol


# Exact transition table T01 - T20
TRANSITIONS: List[Transition] = [
    Transition("T01", "q0", "q1", "ε",       "ε",  "Z0"),
    Transition("T02", "q1", "q0", "ε",       "Z0", "ε"),
    Transition("T03", "q1", "q2", "0-38",    "ε",  "0"),
    Transition("T04", "q2", "q1", "ε",       "0",  "ε"),
    Transition("T05", "q2", "q2", "0-38",    "ε",  "ε"),
    Transition("T06", "q2", "q3", "39-61",   "ε",  "1"),
    Transition("T07", "q3", "q2", "0-38",    "1",  "ε"),
    Transition("T08", "q3", "q3", "39-61",   "ε",  "ε"),
    Transition("T09", "q3", "q4", "62-88",   "ε",  "2"),
    Transition("T10", "q4", "q3", "39-61",   "2",  "ε"),
    Transition("T11", "q4", "q4", "62-88",   "ε",  "ε"),
    Transition("T12", "q4", "q5", "89-117",  "ε",  "3"),
    Transition("T13", "q5", "q4", "62-88",   "3",  "ε"),
    Transition("T14", "q5", "q5", "89-117",  "ε",  "ε"),
    Transition("T15", "q5", "q6", "118-184", "ε",  "4"),
    Transition("T16", "q6", "q5", "89-117",  "4",  "ε"),
    Transition("T17", "q6", "q6", "118-184", "ε",  "ε"),
    Transition("T18", "q6", "q7", ">=185",   "ε",  "5"),
    Transition("T19", "q7", "q6", "118-184", "5",  "ε"),
    Transition("T20", "q7", "q7", ">=185",   "ε",  "ε"),
]


def classify_reading(val: int) -> Tuple[str, str]:
    """Return (band_key, band_display_name) for a non-negative integer wind reading."""
    if 0 <= val <= 38:
        return "0-38", "No signal"
    if 39 <= val <= 61:
        return "39-61", "Signal 1"
    if 62 <= val <= 88:
        return "62-88", "Signal 2"
    if 89 <= val <= 117:
        return "89-117", "Signal 3"
    if 118 <= val <= 184:
        return "118-184", "Signal 4"
    return ">=185", "Signal 5"


def parse_readings(raw_input: str) -> Tuple[Optional[List[int]], Optional[str]]:
    """
    Parse comma- or space-separated wind readings.
    Returns (readings_list, error_message).
    """
    if raw_input is None or not raw_input.strip():
        return [], None

    tokens = [tok for tok in re.split(r"[\s,]+", raw_input.strip()) if tok]
    if len(tokens) > MAX_READINGS:
        return None, f"Input exceeds maximum of {MAX_READINGS} readings ({len(tokens)} provided)."

    readings: List[int] = []
    for idx, tok in enumerate(tokens, start=1):
        if not re.fullmatch(r"[+-]?\d+", tok):
            return None, f"Invalid token '{tok}' at position {idx}: readings must be non-negative integers."
        val = int(tok)
        if val < 0:
            return None, f"Negative reading '{tok}' at position {idx} is not allowed: wind speed must be ≥ 0 km/h."
        readings.append(val)

    return readings, None


def explain_rejection(
    state: str,
    pos: int,
    stack: Tuple[str, ...],
    readings: List[int],
    cap_reached: bool = False,
) -> str:
    """Build a clear plain-English explanation when no accepting run exists."""
    if cap_reached:
        return f"Exploration limit of {MAX_CONFIGS:,} configurations reached without finding an accepting run."

    state_desc = STATE_MEANINGS.get(state, state)
    state_level = {
        "q2": 0,
        "q3": 1,
        "q4": 2,
        "q5": 3,
        "q6": 4,
        "q7": 5,
    }.get(state)

    # Case 1: All input was consumed, but the PDA could not return to q0
    if pos >= len(readings):
        if state in ("q3", "q4", "q5", "q6", "q7"):
            return f"Input ended in {state} ({state_desc}): signals were never lowered back to no signal."
        return f"Input ended in {state} ({state_desc}) with non-empty stack {list(stack)}: did not finish in q0."

    # Case 2: Stuck mid-input at reading readings[pos]
    reading = readings[pos]
    band_key, band_name = classify_reading(reading)
    reading_level = {
        "0-38": 0,
        "39-61": 1,
        "62-88": 2,
        "89-117": 3,
        "118-184": 4,
        ">=185": 5,
    }[band_key]

    if pos == 0 or state in ("q0", "q1"):
        return (
            f"At initial reading {reading} km/h ({band_name}): sequence must start from calm winds "
            f"(0-38 km/h, no signal) via T03, not {band_name}."
        )

    if state_level is not None:
        diff = reading_level - state_level
        if diff > 1:
            skipped = [
                "No signal" if lvl == 0 else f"Signal {lvl}"
                for lvl in range(state_level + 1, reading_level)
            ]
            skipped_str = ", ".join(skipped)
            verb = "was" if len(skipped) == 1 else "were"
            return (
                f"In {state} ({state_desc}), reading {reading} km/h: no transition exists "
                f"({skipped_str} {verb} skipped)."
            )
        if diff < -1:
            skipped = [
                "No signal" if lvl == 0 else f"Signal {lvl}"
                for lvl in range(state_level - 1, reading_level, -1)
            ]
            skipped_str = ", ".join(skipped)
            verb = "was" if len(skipped) == 1 else "were"
            return (
                f"In {state} ({state_desc}), reading {reading} km/h: no transition exists "
                f"(de-escalation skipped {skipped_str}, {verb} not stepped down gradually)."
            )

    return (
        f"In {state} ({state_desc}), reading {reading} km/h ({band_name}): "
        f"no valid transition exists from {state} with stack top '{stack[-1] if stack else 'ε'}'."
    )


def simulate_pda(readings: List[int]) -> Dict:
    """
    Explore PDA configurations (state, input_pos, stack) using BFS.
    Returns a dictionary ready for JSON serialization.
    """
    tape = [
        {
            "index": i,
            "value": r,
            "band": classify_reading(r)[0],
            "band_name": classify_reading(r)[1],
        }
        for i, r in enumerate(readings)
    ]

    # Special explicit handling for empty input
    if len(readings) == 0:
        return {
            "accepted": True,
            "empty_input": True,
            "reason": (
                "ACCEPTED (Empty input is accepted immediately in 0 steps because q0 is both "
                "the start state and the accepting state, with the stack empty)."
            ),
            "steps": [],
            "tape": tape,
            "explored_configs": 1,
        }

    # Configuration is (state, pos, stack_tuple)
    start_config = ("q0", 0, ())
    queue = deque([start_config])
    visited = {start_config}

    # parent_map[config] = (prev_config, step_dict)
    parent_map: Dict[Tuple[str, int, Tuple[str, ...]], Tuple[Optional[Tuple[str, int, Tuple[str, ...]]], Optional[Dict]]] = {
        start_config: (None, None)
    }

    best_config = start_config
    best_rank = (0, 0, 0)  # (input_pos, is_active_signal_state, path_depth)
    depth_map: Dict[Tuple[str, int, Tuple[str, ...]], int] = {start_config: 0}

    explored = 0
    cap_reached = False

    while queue:
        if explored >= MAX_CONFIGS:
            cap_reached = True
            break

        state, pos, stack = queue.popleft()
        explored += 1
        cur_depth = depth_map[(state, pos, stack)]

        # Check acceptance: all input consumed and in q0 (stack is empty by T01..T20 invariants)
        if pos == len(readings) and state == "q0" and len(stack) == 0:
            steps = _reconstruct_steps((state, pos, stack), parent_map)
            return {
                "accepted": True,
                "empty_input": False,
                "reason": "storm signals fully lifted, stack empty, ended in q0",
                "steps": steps,
                "tape": tape,
                "explored_configs": explored,
            }

        # Track best partial configuration in case no accepting run exists.
        # Prefer configurations that consumed the most input, and among ties, prefer
        # staying in the active signal state (q2..q7) rather than prematurely popping 0/Z0 via ε-moves.
        is_active_state = 1 if state in ("q2", "q3", "q4", "q5", "q6", "q7") else 0
        rank = (pos, is_active_state, -cur_depth)
        if rank > best_rank:
            best_rank = rank
            best_config = (state, pos, stack)

        # Generate successors in transition table order (T01..T20)
        for trans in TRANSITIONS:
            if trans.from_state != state:
                continue

            # Check input match
            if trans.band == "ε":
                next_pos = pos
                read_val = "ε"
            else:
                if pos >= len(readings):
                    continue
                reading_val = readings[pos]
                reading_band, _ = classify_reading(reading_val)
                if reading_band != trans.band:
                    continue
                next_pos = pos + 1
                read_val = str(reading_val)

            # Check stack pop
            if trans.pop == "ε":
                temp_stack = stack
            else:
                if not stack or stack[-1] != trans.pop:
                    continue
                temp_stack = stack[:-1]

            # Apply stack push
            if trans.push == "ε":
                next_stack = temp_stack
            else:
                next_stack = temp_stack + (trans.push,)

            next_config = (trans.to_state, next_pos, next_stack)
            if next_config not in visited:
                visited.add(next_config)
                depth_map[next_config] = cur_depth + 1
                step_info = {
                    "transition_id": trans.id,
                    "from_state": trans.from_state,
                    "to_state": trans.to_state,
                    "read": read_val,
                    "pop": trans.pop,
                    "push": trans.push,
                    "stack_after": list(next_stack),  # bottom to top
                    "input_pos_after": next_pos,
                }
                parent_map[next_config] = ((state, pos, stack), step_info)
                queue.append(next_config)

    # No accepting run found
    steps = _reconstruct_steps(best_config, parent_map)
    b_state, b_pos, b_stack = best_config
    reason = explain_rejection(b_state, b_pos, b_stack, readings, cap_reached=cap_reached)

    return {
        "accepted": False,
        "empty_input": False,
        "reason": reason,
        "steps": steps,
        "tape": tape,
        "explored_configs": explored,
    }


def _reconstruct_steps(
    target_config: Tuple[str, int, Tuple[str, ...]],
    parent_map: Dict[Tuple[str, int, Tuple[str, ...]], Tuple[Optional[Tuple[str, int, Tuple[str, ...]]], Optional[Dict]]],
) -> List[Dict]:
    """Reconstruct ordered 1-indexed step list from start configuration to target_config."""
    raw_steps: List[Dict] = []
    curr: Optional[Tuple[str, int, Tuple[str, ...]]] = target_config
    while curr is not None:
        prev, step_data = parent_map[curr]
        if step_data is not None:
            raw_steps.append(dict(step_data))
        curr = prev
    raw_steps.reverse()
    for idx, step in enumerate(raw_steps, start=1):
        step["step"] = idx
    return raw_steps