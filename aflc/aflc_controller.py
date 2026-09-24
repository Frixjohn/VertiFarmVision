"""
aflc_controller.py
─────────────────────────────────────────────────────────────────────────────
Adaptive Fuzzy Logic Controller (AFLC) for the vertical-farm irrigation system.

Pipeline implemented here (matches the architecture we designed):

    [CO2, Temp, RH, Light]
            |
            v
      Fuzzifier  ──► per-parameter deviation degree (0 = optimal, 1 = extreme)
            |
            v
   ECL Inference (Rule Base 1) ──► ECL level (Optimal..Critical), via stress_score
            |
            v
   ECL + CHS (Healthy/Diseased) ──► Rule Base 2 (Table 5) ──► Hold Delay (s)
            |
            v
   Hold-delay gate: stress condition must persist >= HoldDelay before the
   pump is allowed to fire (debounce, so a single noisy reading can't
   trigger irrigation, and a Diseased plant gets a longer "wait and see"
   window than a Healthy one).
            |
            v
   Demand Calculator (RH deficit + Temp excess + ECL severity) ──► Demand %
            |
            v
   Demand % ──► Pump Duration mapping (0-15 s bracket table)
            |
            v
   Adaptive Gain Layer: after a pump run, compare the post-irrigation RH to
   target RH and nudge the duration mapping for that (ECL, bracket) up or
   down for next time. Persisted to disk so it survives restarts.

Only two Crop Health States (CHS) are used, per the revised Table 5:
"healthy" and "diseased" — Pest Damage has been removed (it mirrored the
Diseased column 1:1 in the original table, so nothing is lost).

This module has no hardware/network dependencies — it is pure decision
logic, so it can be unit-tested on its own, imported by a Flask service
(see aflc_service.py), or driven from a CLI for demos (run this file
directly: `python3 aflc_controller.py`).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


# ═════════════════════════════════════════════════════════════════════════
# 1. CONFIG — the "knobs" of the controller, based on Table 5 of the paper
# ═════════════════════════════════════════════════════════════════════════

class ECL(str, Enum):
    OPTIMAL = "Optimal"
    NEAR_OPTIMAL = "Near-Optimal"
    MODERATE_STRESS = "Moderate Stress"
    HIGH_STRESS = "High Stress"
    CRITICAL = "Critical"


class CHS(str, Enum):
    HEALTHY = "Healthy"
    DISEASED = "Diseased"


# --- Parameter fuzzy bands --------------------------------------------------
# Each parameter has: low cutoff, start-of-optimal-ramp, optimal range,
# end-of-optimal-ramp, high cutoff. Outside [low, high] the deviation is 1.0
# (fully out of range); inside the optimal band it's 0.0; on the ramps it's
# interpolated linearly. These numbers come straight from Table 5 / your
# paper's ECL/CHS definitions — edit them here if the paper's numbers change.
PARAM_BANDS = {
    "co2": dict(low=650, ramp_lo=700, opt_lo=700, opt_hi=1200, ramp_hi=1300, high=1300),
    "temperature": dict(low=23, ramp_lo=25, opt_lo=25, opt_hi=35, ramp_hi=37, high=37),
    "humidity": dict(low=80, ramp_lo=83, opt_lo=83, opt_hi=87, ramp_hi=90, high=90),
    "light": dict(low=180, ramp_lo=200, opt_lo=200, opt_hi=500, ramp_hi=550, high=550),
}

# Hard override: this alone forces Critical regardless of the averaged score,
# matching "CO2 >1,500 ppm or most params severely deviated" in Table 5.
CO2_CRITICAL_PPM = 1500

# --- stress_score -> ECL thresholds ----------------------------------------
ECL_THRESHOLDS = [
    (0.10, ECL.OPTIMAL),
    (0.30, ECL.NEAR_OPTIMAL),
    (0.50, ECL.MODERATE_STRESS),
    (0.75, ECL.HIGH_STRESS),
    (float("inf"), ECL.CRITICAL),
]

# --- Rule Base 2 = Table 5 (revised: Healthy / Diseased only) --------------
# ECL x CHS -> hold delay in seconds before the pump is allowed to fire.
HOLD_DELAY_TABLE = {
    (ECL.OPTIMAL, CHS.HEALTHY): 0,
    (ECL.OPTIMAL, CHS.DISEASED): 30,
    (ECL.NEAR_OPTIMAL, CHS.HEALTHY): 15,
    (ECL.NEAR_OPTIMAL, CHS.DISEASED): 60,
    (ECL.MODERATE_STRESS, CHS.HEALTHY): 30,
    (ECL.MODERATE_STRESS, CHS.DISEASED): 90,
    (ECL.HIGH_STRESS, CHS.HEALTHY): 60,
    (ECL.HIGH_STRESS, CHS.DISEASED): 120,
    (ECL.CRITICAL, CHS.HEALTHY): 120,
    (ECL.CRITICAL, CHS.DISEASED): 120,
}

# --- ECL severity weight used only inside the demand calculation -----------
ECL_SEVERITY = {
    ECL.OPTIMAL: 0.0,
    ECL.NEAR_OPTIMAL: 0.25,
    ECL.MODERATE_STRESS: 0.5,
    ECL.HIGH_STRESS: 0.75,
    ECL.CRITICAL: 1.0,
}

# --- Demand % -> pump duration bracket table --------------------------------
# (lower_bound_inclusive, upper_bound_exclusive, duration_seconds)
DEMAND_TO_DURATION = [
    (0, 20, 0),
    (20, 40, 4),
    (40, 60, 7),
    (60, 80, 10),
    (80, 101, 15),  # 101 so 100% falls in this bracket
]

# --- Adaptive layer ----------------------------------------------------------
TARGET_RH = 85.0          # midpoint of the paper's optimal RH band (83-87%)
RH_ERROR_DEADBAND = 2.0   # +/- this much around target counts as "on target"
GAIN_STEP_SECONDS = 1.0   # how much a single feedback cycle nudges duration
GAIN_MIN, GAIN_MAX = -5.0, 8.0  # clamp so gain can't run away

# CHS classifier confidence: below this, we don't trust "Healthy" and fall
# back to "Diseased" (the more cautious / longer-hold branch), since
# under-watering a plant we've misjudged is safer than over-watering a sick
# one on a false-confident reading.
CHS_CONFIDENCE_FLOOR = 0.60


# ═════════════════════════════════════════════════════════════════════════
# 2. FUZZIFICATION — Rule Base 1 (sensors -> ECL)
# ═════════════════════════════════════════════════════════════════════════

def _deviation_degree(value: float, band: dict) -> float:
    """
    0.0  -> value is inside the optimal band
    1.0  -> value is at/beyond the hard low/high cutoff
    (0,1)-> value is on one of the linear ramps
    """
    if band["opt_lo"] <= value <= band["opt_hi"]:
        return 0.0
    if value < band["opt_lo"]:
        if value <= band["low"]:
            return 1.0
        # linear ramp from low(=1.0) to ramp_lo/opt_lo(=0.0)
        span = band["ramp_lo"] - band["low"]
        return 0.0 if span <= 0 else (band["ramp_lo"] - value) / span
    else:  # value > opt_hi
        if value >= band["high"]:
            return 1.0
        span = band["high"] - band["ramp_hi"]
        return 0.0 if span <= 0 else (value - band["ramp_hi"]) / span


def _one_sided_deviation(value: float, band: dict, side: str) -> float:
    """Deviation degree counting only the 'low' or 'high' side (0 elsewhere).
    Used by the demand calculator: e.g. RH below optimal drives demand up,
    RH above optimal should NOT reduce demand via this term."""
    d = _deviation_degree(value, band)
    if side == "low" and value >= band["opt_lo"]:
        return 0.0
    if side == "high" and value <= band["opt_hi"]:
        return 0.0
    return d


def fuzzify(readings: dict) -> dict:
    """Returns per-parameter deviation degrees, each clamped to [0,1]."""
    return {
        p: round(_deviation_degree(readings[p], band), 4)
        for p, band in PARAM_BANDS.items()
        if p in readings and readings[p] is not None
    }


def compute_ecl(readings: dict) -> tuple[ECL, float, dict]:
    """
    Rule Base 1: sensors -> ECL.
    Returns (ecl, stress_score, per_param_deviations).
    """
    deviations = fuzzify(readings)
    if not deviations:
        raise ValueError("No usable sensor readings supplied to compute_ecl().")

    stress_score = sum(deviations.values()) / len(deviations)

    co2 = readings.get("co2")
    if co2 is not None and co2 > CO2_CRITICAL_PPM:
        return ECL.CRITICAL, round(stress_score, 4), deviations

    for threshold, level in ECL_THRESHOLDS:
        if stress_score < threshold:
            return level, round(stress_score, 4), deviations

    return ECL.CRITICAL, round(stress_score, 4), deviations  # unreachable safety net


# ═════════════════════════════════════════════════════════════════════════
# 3. RULE BASE 2 — Table 5 (ECL + CHS -> hold delay)
# ═════════════════════════════════════════════════════════════════════════

def resolve_chs(chs_label: str, chs_confidence: Optional[float]) -> CHS:
    """Turn a raw classifier label into a CHS enum, applying the confidence
    floor described above. Accepts 'healthy'/'diseased' in any case, or
    already-cast CHS values."""
    if isinstance(chs_label, CHS):
        label = chs_label
    else:
        label = CHS.HEALTHY if str(chs_label).strip().lower() == "healthy" else CHS.DISEASED

    if label is CHS.HEALTHY and chs_confidence is not None and chs_confidence < CHS_CONFIDENCE_FLOOR:
        return CHS.DISEASED  # cautious fallback, see CHS_CONFIDENCE_FLOOR comment
    return label


def hold_delay_seconds(ecl: ECL, chs: CHS) -> int:
    """Direct Table 5 lookup."""
    return HOLD_DELAY_TABLE[(ecl, chs)]


# ═════════════════════════════════════════════════════════════════════════
# 4. IRRIGATION DEMAND -> PUMP DURATION
# ═════════════════════════════════════════════════════════════════════════

def compute_demand_pct(readings: dict, ecl: ECL) -> float:
    """
    demand% = f(RH deficit, Temp excess, ECL severity)
    Weighted 50/30/20 — RH shortfall matters most (it's the direct proxy for
    how dry the growing environment is), temperature excess next (drives
    transpiration), and overall ECL severity as a baseline nudge.
    """
    rh_low = _one_sided_deviation(readings.get("humidity", TARGET_RH), PARAM_BANDS["humidity"], "low")
    temp_high = _one_sided_deviation(readings.get("temperature", 25), PARAM_BANDS["temperature"], "high")
    ecl_term = ECL_SEVERITY[ecl]

    demand = 100 * (0.5 * rh_low + 0.3 * temp_high + 0.2 * ecl_term)
    return round(max(0.0, min(100.0, demand)), 2)


def base_duration_for_demand(demand_pct: float) -> tuple[int, int]:
    """Returns (duration_seconds, bracket_index) from the step table."""
    for i, (lo, hi, dur) in enumerate(DEMAND_TO_DURATION):
        if lo <= demand_pct < hi:
            return dur, i
    return DEMAND_TO_DURATION[-1][2], len(DEMAND_TO_DURATION) - 1


# ═════════════════════════════════════════════════════════════════════════
# 5. ADAPTIVE GAIN LAYER (persisted)
# ═════════════════════════════════════════════════════════════════════════

@dataclass
class AdaptiveState:
    """Per-node persisted state: gain table + hold-delay timer bookkeeping."""
    gains: dict = field(default_factory=dict)          # "ECL|bracket" -> seconds offset
    condition_since: Optional[float] = None             # epoch seconds; None = not currently stressed
    condition_key: Optional[str] = None                 # f"{ecl}|{chs}" the timer is tracking
    last_decision: Optional[dict] = None

    def gain_for(self, ecl: ECL, bracket: int) -> float:
        return self.gains.get(f"{ecl.value}|{bracket}", 0.0)

    def nudge_gain(self, ecl: ECL, bracket: int, delta: float) -> float:
        key = f"{ecl.value}|{bracket}"
        new_val = self.gains.get(key, 0.0) + delta
        new_val = max(GAIN_MIN, min(GAIN_MAX, new_val))
        self.gains[key] = round(new_val, 2)
        return self.gains[key]


def _load_state(path: str) -> AdaptiveState:
    if path and os.path.exists(path):
        with open(path, "r") as f:
            raw = json.load(f)
        return AdaptiveState(**raw)
    return AdaptiveState()


def _save_state(path: str, state: AdaptiveState) -> None:
    if not path:
        return
    with open(path, "w") as f:
        json.dump(asdict(state), f, indent=2)


# ═════════════════════════════════════════════════════════════════════════
# 6. THE CONTROLLER — ties everything together, per irrigation node
# ═════════════════════════════════════════════════════════════════════════

class AFLCController:
    """
    One instance per irrigation node (e.g. 'node1', 'node2').

    Usage:
        ctrl = AFLCController("node1", state_path="node1_state.json")
        decision = ctrl.evaluate({
            "temperature": 29.0, "humidity": 78.0, "co2": 950, "light": 480,
            "chs": "diseased", "chs_confidence": 0.87,
        })
        # decision["pumpDurationSec"] > 0 and decision["decision"] == "IRRIGATE"
        # means: fire the pump now, for that many seconds.

        # ... after the pump actually runs and you take a fresh RH reading ...
        ctrl.record_feedback(post_humidity=83.5)
    """

    def __init__(self, node_id: str, state_path: Optional[str] = None):
        self.node_id = node_id
        self.state_path = state_path
        self.state = _load_state(state_path)

    # -- main entry point -----------------------------------------------
    def evaluate(self, readings: dict, now: Optional[float] = None) -> dict:
        now = now if now is not None else time.time()

        ecl, stress_score, deviations = compute_ecl(readings)
        chs = resolve_chs(readings.get("chs", "healthy"), readings.get("chs_confidence"))
        hold_delay = hold_delay_seconds(ecl, chs)

        demand_pct = compute_demand_pct(readings, ecl)
        base_duration, bracket = base_duration_for_demand(demand_pct)
        gain = self.state.gain_for(ecl, bracket)
        adjusted_duration = max(0, round(base_duration + gain))

        # -- hold-delay debounce state machine ---------------------------
        condition_key = f"{ecl.value}|{chs.value}"
        stressed = ecl is not ECL.OPTIMAL

        if not stressed:
            self.state.condition_since = None
            self.state.condition_key = None
            ready = True  # nothing to wait for; pump simply won't fire (duration=0)
            waited_for = 0.0
        else:
            if self.state.condition_key != condition_key:
                # condition just changed (or just started) -> reset timer
                self.state.condition_since = now
                self.state.condition_key = condition_key
            waited_for = now - self.state.condition_since
            ready = waited_for >= hold_delay

        pump_seconds = adjusted_duration if (stressed and ready and adjusted_duration > 0) else 0

        # -- map onto the existing dashboard's decision/confidence/reason --
        if pump_seconds > 0:
            decision_label = "IRRIGATE"
            reason = (f"{ecl.value} conditions confirmed for {int(waited_for)}s "
                      f"(hold {hold_delay}s, plant {chs.value.lower()}) — running pump {pump_seconds}s.")
        elif stressed:
            decision_label = "MONITOR"
            remaining = max(0, round(hold_delay - waited_for))
            reason = (f"{ecl.value} conditions detected, plant {chs.value.lower()} — "
                      f"confirming for {remaining}s more before irrigating "
                      f"(hold delay {hold_delay}s guards against overwatering a stressed reading).")
        else:
            decision_label = "OPTIMAL"
            reason = "All monitored parameters within the optimal band."

        confidence = round(min(95, max(55, 60 + stress_score * 40)), 1)

        result = {
            "node": self.node_id,
            "decision": decision_label,          # IRRIGATE | MONITOR | OPTIMAL  (matches existing UI badges)
            "confidence": confidence,             # %
            "reason": reason,
            "ecl": ecl.value,
            "chs": chs.value,
            "stressScore": stress_score,
            "deviations": deviations,             # per-parameter 0..1 fuzzy deviation
            "holdDelaySec": hold_delay,
            "conditionPersistedSec": round(waited_for, 1),
            "demandPct": demand_pct,
            "baseDurationSec": base_duration,
            "adaptiveGainSec": gain,
            "pumpDurationSec": pump_seconds,      # 0 = don't fire the pump this cycle
            "demandBracket": bracket,
            "timestamp": now,
        }
        self.state.last_decision = result
        _save_state(self.state_path, self.state)
        return result

    # -- adaptive feedback -------------------------------------------------
    def record_feedback(self, post_humidity: float, target_rh: float = TARGET_RH) -> Optional[dict]:
        """
        Call this after a pump run completes and you've taken a fresh
        humidity reading. Adjusts the gain table for the (ECL, bracket)
        combination that fired, so the SAME rule base produces a better
        duration next time similar conditions occur. This is the
        "Adaptive" half of AFLC — the fuzzy rules never change.
        """
        last = self.state.last_decision
        if not last or last["pumpDurationSec"] <= 0:
            return None  # nothing fired last cycle, nothing to adapt

        error = target_rh - post_humidity
        ecl = ECL(last["ecl"])
        bracket = last["demandBracket"]

        if error > RH_ERROR_DEADBAND:
            new_gain = self.state.nudge_gain(ecl, bracket, +GAIN_STEP_SECONDS)
            note = f"Still {error:.1f}pp below target RH — increasing duration for this bracket."
        elif error < -RH_ERROR_DEADBAND:
            new_gain = self.state.nudge_gain(ecl, bracket, -GAIN_STEP_SECONDS)
            note = f"Overshot target RH by {-error:.1f}pp — decreasing duration for this bracket."
        else:
            new_gain = self.state.gain_for(ecl, bracket)
            note = "Within deadband of target RH — no adjustment."

        _save_state(self.state_path, self.state)
        return {"node": self.node_id, "postHumidity": post_humidity, "error": round(error, 2),
                "newGainSec": new_gain, "note": note}


# ═════════════════════════════════════════════════════════════════════════
# 7. CLI DEMO — run this file directly to see the pipeline reason step by
#    step over a few example scenarios (handy for a thesis demo/screenshot).
# ═════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    scenarios = [
        ("Healthy, everything optimal",
         dict(temperature=28, humidity=85, co2=900, light=350, chs="healthy", chs_confidence=0.95)),
        ("Diseased, everything optimal",
         dict(temperature=28, humidity=85, co2=900, light=350, chs="diseased", chs_confidence=0.9)),
        ("Healthy, moderately dry + warm",
         dict(temperature=33, humidity=74, co2=1100, light=420, chs="healthy", chs_confidence=0.92)),
        ("Diseased, high stress",
         dict(temperature=38, humidity=65, co2=1350, light=150, chs="diseased", chs_confidence=0.88)),
        ("Low-confidence 'healthy' reading under stress",
         dict(temperature=36, humidity=68, co2=1250, light=170, chs="healthy", chs_confidence=0.40)),
        ("Critical: CO2 hard override",
         dict(temperature=30, humidity=80, co2=1600, light=300, chs="healthy", chs_confidence=0.9)),
    ]

    print("=" * 88)
    ctrl = AFLCController("demo-node")  # no state_path -> in-memory only, nothing written to disk
    for label, reading in scenarios:
        d = ctrl.evaluate(reading, now=time.time())
        print(f"\n[{label}]")
        print(f"  readings        : {reading}")
        print(f"  ECL / CHS       : {d['ecl']} / {d['chs']}  (stress_score={d['stressScore']})")
        print(f"  decision        : {d['decision']}  (confidence {d['confidence']}%)")
        print(f"  hold delay      : {d['holdDelaySec']}s   demand: {d['demandPct']}%")
        print(f"  pump duration   : {d['pumpDurationSec']}s")
        print(f"  reason          : {d['reason']}")
        # reset the timer between unrelated demo scenarios so each one is judged fresh
        ctrl.state.condition_since = None
        ctrl.state.condition_key = None
    print("\n" + "=" * 88)
    print("Note: MONITOR results above are correct — the hold-delay timer only just started")
    print("(now=time.time() each call). Feed the same stressed reading again after waiting")
    print("past hold_delay_seconds and it will flip to IRRIGATE. See README.md for the")
    print("persistence loop that makes this work against real, periodic sensor polling.")
