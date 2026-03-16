"""
conftest.py — root conftest for odin-injector pytest runs.

Adds both odin-telemetry and odin-injector to sys.path so that
namespace packages (core/, stream/, profiles/, curves/, engine/)
are importable without setting PYTHONPATH manually.

Run from odin-injector/:
    pytest tests/ -v
"""

import sys
import os

_INJECTOR = os.path.dirname(os.path.abspath(__file__))
_FORESIGHT = os.path.dirname(_INJECTOR)

sys.path.insert(0, os.path.join(_FORESIGHT, "odin-telemetry"))
sys.path.insert(0, _INJECTOR)
