"""
Pushdown Automaton (PDA) Engine for PAGASA Signal Tracker.
Implements the exact 8-state, 20-transition nondeterministic PDA using BFS.
"""
from collections import deque
from typing import List, Dict, Any, Tuple, Optional

# Exact transition table (T01 to T20) as defined in specification[cite: 1]
# Format: (id, from_state, to_state, band_min, band_max, pop_sym, push_sym)
# band_min/band_max = None means epsilon (ε) input read.
# pop_sym/push_sym = None means epsilon (ε) stack operation.
TRANSITIONS = [
    ("T01", "q0", "q1", None, None, None, "Z0"),
    ("T02", "q1", "q0", None, None, "Z0", None),
    ("T03", "q1", "q2", 0, 38, None, "0"),
    ("T04", "q2", "q1", None, None, "0", None),
    ("T05", "q2", "q2", 0, 38, None, None),
    ("T06", "q2", "q3", 39, 61, None, "1"),
    ("T07", "q3", "q2", 0, 38, "1", None),
    ("T08", "q3", "q3", 39, 61, None, None),
    ("T09", "q3", "q4", 62, 88, None, "2"),
    ("T10", "q4", "q3", 39, 61, "2", None),
    ("T11", "q4", "q4", 62, 88, None, None),
    ("T12", "q4", "q5", 89, 117, None, "3"),
    ("T13", "q5", "q4", 62, 88, "3", None),
    ("T14", "q5", "q5", 89, 117, None, None),
    ("T15", "q5", "q6", 118, 184, None, "4"),
    ("T16", "q6", "q5", 89, 117, "4", None),
    ("T17", "q6", "q6", 118, 184, None, None),
    ("T18", "q6", "q7", 185, float("inf"), None, "5"),
    ("T19", "q7", "q6", 118, 184, "5", None),
    ("T20", "q7", "q7", 185, float("inf"), None, None),
]

STATE_TO_SIGNAL = {
    "q0": 0,
    "q1": 0,
    "q2": 0,
    "q3": 1,
    "q4": 2,
    "q5": 3,
    "q6": 4,
    "q7": 5,
}


def wind_to_signal_info(wind: int) -> Tuple[int, str, str]:
    """Maps wind speed (km/h) to (signal_int, signal_label, band_label)."""
    if wind <= 38:
        return 0, "No Signal (0)", "0-38 km/h"
    elif wind <= 61:
        return 1, "Signal 1", "39-61 km/h"
    elif wind <= 88:
        return 2, "Signal 2", "62-88 km/h"
    elif wind <= 117:
        return 3, "Signal 3", "89-117 km/h"
    elif wind <= 184:
        return 4, "Signal 4", "118-184 km/h"
    else:
        return 5, "Signal 5", ">=185 km/h"


def run_pda_bfs(readings: List[int], max_configs: int = 100000) -> Dict[str, Any]:
    """
    Executes the Nondeterministic PDA over the sequence of wind readings using BFS
    with a visited set capped at 100,000 configurations.
    """
    n = len(readings)
    if n == 0:
        return {
            "accepted": True,
            "peak_signal": 0,
            "escalations": 0,
            "de_escalations": 0,
            "reason": "",
            "bulletins": [],
            "current_state": "q0",
            "current_stack": [],
            "current_signal": "No Signal (0)",
            "last_edge": None,
        }

    # Configuration: (input_index, state, stack_tuple)
    # History entry per consumed input: (input_idx, trans_id, from_st, to_st, stack_after)
    start_config = (0, "q0", ())
    queue = deque([(start_config, [])])
    visited = {start_config}
    configs_explored = 0

    accepting_history = None
    best_partial_history = []
    best_partial_idx = -1
    best_partial_in_active_state = False

    while queue and configs_explored < max_configs:
        (idx, state, stack), history = queue.popleft()
        configs_explored += 1

        # Track furthest valid reading consumption
        if idx > best_partial_idx or (
            idx == best_partial_idx
            and state in ("q2", "q3", "q4", "q5", "q6", "q7")
            and not best_partial_in_active_state
        ):
            best_partial_idx = idx
            best_partial_history = history
            best_partial_in_active_state = state in ("q2", "q3", "q4", "q5", "q6", "q7")

        # Check acceptance condition: all readings consumed, state == q0, stack empty
        if idx == n and state == "q0" and len(stack) == 0:
            accepting_history = history
            break

        for t_id, f_st, t_st, b_min, b_max, pop_s, push_s in TRANSITIONS:
            if f_st != state:
                continue

            # Check stack pop requirement
            if pop_s is not None:
                if len(stack) == 0 or stack[-1] != pop_s:
                    continue
                next_stack = stack[:-1]
            else:
                next_stack = stack

            # Check stack push operation
            if push_s is not None:
                next_stack = next_stack + (push_s,)

            # Case 1: Epsilon transition (no input consumed)
            if b_min is None:
                next_idx = idx
                next_cfg = (next_idx, t_st, next_stack)
                if next_cfg not in visited and len(next_stack) <= n + 4:
                    visited.add(next_cfg)
                    next_hist = history + [(idx, t_id, f_st, t_st, list(next_stack), True)]
                    queue.append((next_cfg, next_hist))
            # Case 2: Reading transition
            else:
                if idx < n and b_min <= readings[idx] <= b_max:
                    next_idx = idx + 1
                    next_cfg = (next_idx, t_st, next_stack)
                    if next_cfg not in visited and len(next_stack) <= n + 4:
                        visited.add(next_cfg)
                        next_hist = history + [(idx, t_id, f_st, t_st, list(next_stack), False)]
                        queue.append((next_cfg, next_hist))

    chosen_history = accepting_history if accepting_history is not None else best_partial_history
    accepted = accepting_history is not None

    # Map chosen transition path back to individual bulletins
    # Each reading i corresponds to the reading transition where input i was consumed,
    # plus any trailing epsilon transitions if it's the final reading of an accepted run.
    step_records: Dict[int, Dict[str, Any]] = {}
    for step_idx, t_id, f_st, t_st, st_after, is_eps in chosen_history:
        if not is_eps:
            step_records[step_idx] = {
                "read_trans": t_id,
                "read_from": f_st,
                "read_to": t_st,
                "final_trans": t_id,
                "final_state": t_st,
                "final_stack": st_after,
            }
        else:
            # Attach trailing epsilon transitions (e.g., T04 -> T02 at end of run) to the just-consumed reading
            prev_reading_idx = step_idx - 1
            if prev_reading_idx in step_records:
                step_records[prev_reading_idx]["final_trans"] = t_id
                step_records[prev_reading_idx]["final_state"] = t_st
                step_records[prev_reading_idx]["final_stack"] = st_after

    bulletins_out = []
    peak_signal = 0
    escalations = 0
    de_escalations = 0
    outside_model_occurred = False
    first_outside_idx: Optional[int] = None

    last_valid_state = "q0"
    last_valid_stack: List[str] = []

    for i, w in enumerate(readings):
        sig_num, sig_label, band_label = wind_to_signal_info(w)
        if sig_num > peak_signal:
            peak_signal = sig_num

        if i in step_records and not outside_model_occurred:
            rec = step_records[i]
            r_trans = rec["read_trans"]
            f_state = rec["final_state"]
            f_stack = rec["final_stack"]
            f_trans = rec["final_trans"]

            # Determine status from reading transition
            if r_trans in ("T06", "T09", "T12", "T15", "T18"):
                status = f"RAISED to Signal {sig_num}"
                escalations += 1
            elif r_trans in ("T10", "T13", "T16", "T19"):
                status = f"LOWERED to Signal {sig_num}"
                de_escalations += 1
            elif r_trans == "T07":
                de_escalations += 1
                # Lowered from Signal 1 back to 0-38 calm
                if f_state == "q0" or i == n - 1:
                    status = "ALL CLEAR"
                else:
                    status = "LOWERED to Signal 0"
            elif r_trans in ("T08", "T11", "T14", "T17", "T20"):
                status = f"MAINTAINED at Signal {sig_num}"
            elif r_trans == "T03":
                if f_state == "q0":
                    status = "ALL CLEAR"
                else:
                    status = "ALL CLEAR"
            elif r_trans == "T05":
                if f_state == "q0":
                    status = "ALL CLEAR"
                else:
                    status = "MAINTAINED at Signal 0"
            else:
                status = f"MAINTAINED at Signal {sig_num}"

            last_valid_state = f_state
            last_valid_stack = f_stack

            bulletins_out.append({
                "index": i + 1,
                "wind": w,
                "signal_num": sig_num,
                "signal_label": sig_label,
                "band_label": band_label,
                "status": status,
                "pda_state": f_state,
                "stack": f_stack,
                "edge": f_trans,
                "read_edge": r_trans,
            })
        else:
            outside_model_occurred = True
            if first_outside_idx is None:
                first_outside_idx = i + 1
            bulletins_out.append({
                "index": i + 1,
                "wind": w,
                "signal_num": sig_num,
                "signal_label": sig_label,
                "band_label": band_label,
                "status": "OUTSIDE MODEL",
                "pda_state": last_valid_state,
                "stack": last_valid_stack,
                "edge": None,
                "read_edge": None,
            })

    # Plain-English reason when not accepted
    reason = ""
    if not accepted:
        if outside_model_occurred:
            reason = (
                "Outside orderly-progression model: verify the data. "
                "Real storms can intensify rapidly."
            )
        else:
            cur_sig = STATE_TO_SIGNAL.get(last_valid_state, 0)
            if cur_sig > 0:
                reason = (
                    f"Storm lifecycle incomplete: currently active at Signal {cur_sig} "
                    f"(state {last_valid_state}). Signals have not yet de-escalated back to calm (0-38 km/h)."
                )
            else:
                reason = "Storm lifecycle did not return to idle state q0."

    last_b = bulletins_out[-1]
    return {
        "accepted": accepted,
        "peak_signal": peak_signal,
        "escalations": escalations,
        "de_escalations": de_escalations,
        "reason": reason,
        "bulletins": bulletins_out,
        "current_state": last_b["pda_state"],
        "current_stack": last_b["stack"],
        "current_signal": last_b["signal_label"],
        "last_edge": last_b["read_edge"] or last_b["edge"],
    }