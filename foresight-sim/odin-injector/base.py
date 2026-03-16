"""
curves/base.py

Degradation curve implementations. A curve maps:
  (current_day, failure_start_day, progression_days) → degradation_factor [0.0, 1.0]

The degradation_factor is then passed to each sensor's effect function
in the failure mode library.

Four curve shapes:
  sigmoid     — slow start, sharp acceleration past the midpoint.
                Most realistic — matches how wear manifests in real sensors.
                Default for all failure modes.

  linear      — uniform progression. Useful for testing.

  exponential — fast early progression, slow late.
                Models failures that appear suddenly (e.g. physical damage).

  step        — jumps directly to 1.0 at failure_start_day.
                Models catastrophic / sudden failure (blown fuse, shorted wire).
                DTC fires immediately.

All curves:
  - Return 0.0 before failure_start_day
  - Reach 1.0 at or before failure_start_day + progression_days
  - Are monotonically non-decreasing
  - Are clipped to [0.0, 1.0]
"""

from __future__ import annotations
import numpy as np
from abc import ABC, abstractmethod


class BaseCurve(ABC):
    """Abstract base class for degradation curves."""

    @abstractmethod
    def factor(self, current_day: int, failure_start_day: int, progression_days: int) -> float:
        """Return degradation_factor in [0.0, 1.0]."""
        ...

    def _progress(self, current_day: int, failure_start_day: int, progression_days: int) -> float:
        """
        Normalized progress [0.0, 1.0] through the failure window.
        Returns 0.0 before failure starts. Clips at 1.0 at end of window.
        """
        if current_day < failure_start_day:
            return 0.0
        elapsed = current_day - failure_start_day
        return float(np.clip(elapsed / progression_days, 0.0, 1.0))


class SigmoidCurve(BaseCurve):
    """
    Sigmoid degradation curve. Default for all failure modes.
    Steepness controls how sharply the curve accelerates at the midpoint.
    
    At steepness=10:
      progress 0.0 → factor ~0.007  (nearly flat early on)
      progress 0.5 → factor ~0.500  (midpoint crossover)
      progress 0.8 → factor ~0.952  (approaching threshold)
      progress 1.0 → factor ~0.993  (asymptotic to 1.0)
    """

    def __init__(self, steepness: float = 10.0):
        self.steepness = steepness

    def factor(self, current_day: int, failure_start_day: int, progression_days: int) -> float:
        p = self._progress(current_day, failure_start_day, progression_days)
        if p == 0.0:
            return 0.0
        # Sigmoid centered at p=0.5
        raw = 1.0 / (1.0 + np.exp(-self.steepness * (p - 0.5)))
        # Rescale so factor(0) = 0 and factor(1) ≈ 1
        f_min = 1.0 / (1.0 + np.exp(self.steepness * 0.5))
        f_max = 1.0 / (1.0 + np.exp(-self.steepness * 0.5))
        rescaled = (raw - f_min) / (f_max - f_min)
        return float(np.clip(rescaled, 0.0, 1.0))


class LinearCurve(BaseCurve):
    """
    Linear degradation — uniform rate from 0 to 1 over progression_days.
    Used for baseline testing and as a sanity check for the injector.
    """

    def factor(self, current_day: int, failure_start_day: int, progression_days: int) -> float:
        return self._progress(current_day, failure_start_day, progression_days)


class ExponentialCurve(BaseCurve):
    """
    Exponential degradation — fast early onset, slow late progression.
    Models failures that worsen quickly at first (e.g. contamination) then plateau.
    factor = progress^0.4 gives fast early rise.
    """

    def __init__(self, exponent: float = 0.4):
        self.exponent = exponent

    def factor(self, current_day: int, failure_start_day: int, progression_days: int) -> float:
        p = self._progress(current_day, failure_start_day, progression_days)
        if p == 0.0:
            return 0.0
        return float(np.clip(p ** self.exponent, 0.0, 1.0))


class StepCurve(BaseCurve):
    """
    Step function — jumps to 1.0 on failure_start_day.
    DTC fires immediately. Models catastrophic failure.
    """

    def factor(self, current_day: int, failure_start_day: int, progression_days: int) -> float:
        return 1.0 if current_day >= failure_start_day else 0.0


# ── Factory ──────────────────────────────────────────────────────────────────

_CURVE_REGISTRY = {
    "sigmoid": SigmoidCurve,
    "linear": LinearCurve,
    "exponential": ExponentialCurve,
    "step": StepCurve,
}


def get_curve(shape: str) -> BaseCurve:
    if shape not in _CURVE_REGISTRY:
        raise ValueError(
            f"Unknown curve shape '{shape}'. "
            f"Available: {list(_CURVE_REGISTRY.keys())}"
        )
    return _CURVE_REGISTRY[shape]()


def plot_curve_ascii(shape: str, width: int = 60, height: int = 12) -> str:
    """
    Render a degradation curve as an ASCII plot for terminal validation.
    Returns the plot as a string.
    """
    curve = get_curve(shape)
    days = 90
    factors = [curve.factor(d, 0, days) for d in range(days + 1)]

    lines = []
    lines.append(f"  {shape.upper()} curve (0 → {days} days)")
    lines.append(f"  {'─' * width}")

    for row in range(height, -1, -1):
        threshold = row / height
        line = ""
        for d in range(0, days + 1, max(1, days // width)):
            f = factors[d]
            if abs(f - threshold) < (1 / height):
                line += "█"
            elif f > threshold:
                line += "│"
            else:
                line += " "

        y_label = f"{threshold:4.2f} │"
        lines.append(f"  {y_label}{line}")

    lines.append(f"  {'─' * (width + 6)}")
    lines.append(f"       0{'day':>20}{days // 2}{'':>17}{days}")
    return "\n".join(lines)
