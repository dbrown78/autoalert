"""
scripts/demo_injection.py
Run a single or all failure injections and print per-day summaries.
Shows degradation_factor climbing, DTC fire day, and severity transitions.

Usage:
    python scripts/demo_injection.py --failure o2_sensor --days 60 --verbose
    python scripts/demo_injection.py --all-failures --days 90
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.config import InjectionConfig
from core.vehicle import make_vehicle_profile
from engine.injector import FailureInjector
from curves.library import FAILURE_MODES
from stream.generator import TelemetryGenerator


BAR_WIDTH = 30


def factor_bar(factor: float) -> str:
    filled = int(factor * BAR_WIDTH)
    bar = "█" * filled + "░" * (BAR_WIDTH - filled)
    return f"[{bar}] {factor:.3f}"


def severity_color(severity: str) -> str:
    colors = {
        "healthy":  "\033[32m",   # Green
        "early":    "\033[33m",   # Yellow
        "late":     "\033[31m",   # Red
        "imminent": "\033[35m",   # Magenta
    }
    reset = "\033[0m"
    return f"{colors.get(severity, '')}{severity:<8}{reset}"


def run_single(failure_name: str, n_days: int, seed: int, verbose: bool):
    mode = FAILURE_MODES[failure_name]
    profile = make_vehicle_profile("DEMO-INJECT", "sedan_high_mileage", seed=seed)
    gen = TelemetryGenerator(profile)

    failure_start = max(2, n_days // 6)
    config = InjectionConfig.from_failure_mode(
        failure_name,
        failure_start_day=failure_start,
        curve_shape=mode.default_curve,
    )
    inj = FailureInjector(gen, config)

    print(f"\n{'─'*65}")
    print(f"  Failure: {mode.display_name}")
    print(f"  DTC:     {mode.dtc_code} — {mode.dtc_description}")
    print(f"  Start:   Day {failure_start} | Progression: {config.progression_days} days | Curve: {config.curve_shape}")
    print(f"{'─'*65}")

    if verbose:
        print(f"  {'Day':<5} {'Factor bar':<35} {'Severity':<10} {'Days→DTC'}")
        print(f"  {'─'*65}")

    prev_severity = "healthy"
    for day in range(n_days):
        label = inj.advance_day()

        if verbose and (day % 5 == 0 or label.label_severity != prev_severity or day == n_days - 1):
            days_dtc_str = str(label.days_to_dtc) if label.days_to_dtc is not None else "fired" if inj.dtc_fired else "—"
            print(f"  {day:<5} {factor_bar(label.degradation_factor):<35} {severity_color(label.label_severity)} {days_dtc_str}")

        prev_severity = label.label_severity

    print()
    if inj.dtc_fired:
        e = inj.dtc_event
        print(f"  ✓ DTC {e.dtc_code} fired on Day {e.fire_day} (factor={e.degradation_factor_at_fire:.3f})")
        print(f"    Days of warning: {e.fire_day - failure_start} days between start and DTC")
    else:
        print(f"  ✗ DTC never fired in {n_days} days")

    print()
    return inj.summary()


def run_all_failures(n_days: int, seed: int):
    print(f"\n{'═'*70}")
    print(f"  All Failure Modes — {n_days}-Day Simulation")
    print(f"{'═'*70}")
    print(f"  {'Failure Mode':<30} {'DTC':<8} {'Start':<7} {'Fire Day':<10} {'Warning'}")
    print(f"  {'─'*65}")

    for name in FAILURE_MODES:
        mode = FAILURE_MODES[name]
        profile = make_vehicle_profile(f"ALL-{name}", "sedan_high_mileage", seed=seed)
        gen = TelemetryGenerator(profile)
        failure_start = max(2, n_days // 6)
        # Cap progression so DTC fires within the simulation window
        max_progression = max(5, n_days - failure_start - 5)
        progression_days = min(mode.typical_progression_days, max_progression)
        config = InjectionConfig(
            failure_mode_name=name,
            failure_start_day=failure_start,
            progression_days=progression_days,
            curve_shape=mode.default_curve,
        )
        inj = FailureInjector(gen, config)

        for _ in range(n_days):
            inj.advance_day()

        if inj.dtc_fired:
            fire_day = inj.dtc_event.fire_day
            warning_days = fire_day - failure_start
            status = f"Day {fire_day:<7} {warning_days} days warning"
        else:
            status = "DID NOT FIRE ✗"

        print(f"  {name:<30} {mode.dtc_code:<8} {failure_start:<7} {status}")

    print()


def main():
    parser = argparse.ArgumentParser(description="ODIN Failure Injection Demo")
    parser.add_argument("--failure", type=str, default="o2_sensor")
    parser.add_argument("--all-failures", action="store_true")
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--verbose", action="store_true", default=True)
    args = parser.parse_args()

    if args.all_failures:
        run_all_failures(args.days, args.seed)
    else:
        if args.failure not in FAILURE_MODES:
            print(f"Unknown failure: {args.failure}")
            print(f"Available: {list(FAILURE_MODES.keys())}")
            return
        run_single(args.failure, args.days, args.seed, args.verbose)


if __name__ == "__main__":
    main()
