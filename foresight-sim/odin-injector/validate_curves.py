"""
scripts/validate_curves.py
Print all 10 failure modes with ASCII degradation curve plots.
First thing Claude Code runs to confirm the library loaded correctly.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from curves.library import FAILURE_MODES, failure_mode_summary
from curves.base import plot_curve_ascii, SigmoidCurve


def main():
    print("\n" + "═" * 75)
    print("  ODIN AutoAlert — Failure Injector Curve Validation")
    print("═" * 75)

    print("\n── Failure Mode Registry ──\n")
    print(failure_mode_summary())

    print("\n\n── Degradation Curve Shapes ──\n")
    for shape in ["sigmoid", "linear", "exponential", "step"]:
        print(plot_curve_ascii(shape, width=55, height=8))
        print()

    print("── Per-Failure-Mode Details ──\n")
    for name, mode in FAILURE_MODES.items():
        print(f"  {mode.display_name} ({name})")
        print(f"    DTC:        {mode.dtc_code} — {mode.dtc_description}")
        print(f"    Severity:   {mode.severity}")
        print(f"    Progression: {mode.typical_progression_days} days (default curve: {mode.default_curve})")
        print(f"    Affected sensors:")
        for e in mode.affected_sensors:
            print(f"      - {e.sensor_name:<25}  {e.description}")
        print()

    print("✓ All failure modes validated.\n")


if __name__ == "__main__":
    main()
